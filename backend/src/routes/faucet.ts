import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { config } from "../config.js";
import {
  completeSocialClaim,
  getClaim,
  getRecentStarterPackClaimByAddress,
  getRecentStarterPackClaimByIpHash,
  getStarterPackStats,
  insertClaimEvent,
  insertStarterPackClaim,
  markSocialClaimNeedsReview,
  reserveSocialClaim,
  updateStarterPackClaim,
  upsertClaim
} from "../db.js";
import { sendRmzToAddress, sendXecToAddress } from "../services/bitcoinAbcRpc.js";
import { verifyRmzGate } from "../services/rmzGate.js";
import { verifyTurnstileToken } from "../services/turnstile.js";
import { cleanTwitterHandle, verifyRetweetAndGetUserId } from "../services/twitter.js";
import { AppError, errorMessage, serverErrorMessage } from "../utils/errors.js";
import { hashIp } from "../utils/ipHash.js";

export const faucetRouter = Router();

const ipClaimLimiter = rateLimit({
  windowMs: config.ipClaimLimitWindowMs,
  limit: config.ipClaimLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite de reclamos por red alcanzado. Intenta mas tarde." }
});

const addressLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const address = typeof req.body?.address === "string" ? req.body.address.toLowerCase() : "unknown";
    return `${req.ip}:${address}`;
  },
  message: { error: "Demasiados intentos. Intenta de nuevo mas tarde." }
});

function cleanEventCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : null;
}

function assertCooldown(lastClaimAt: string | null): void {
  if (!lastClaimAt) return;
  const last = Date.parse(lastClaimAt);
  if (!Number.isFinite(last)) return;
  const cooldownMs = config.addressCooldownHours * 60 * 60 * 1000;
  const nextAllowed = last + cooldownMs;
  if (Date.now() < nextAllowed) {
    throw new AppError(429, `Esta direccion debe esperar ${config.addressCooldownHours} horas entre claims.`);
  }
}

function xecFromSats(sats: string): string {
  const value = BigInt(sats);
  if (value <= 0n) {
    throw new AppError(500, "STARTER_XEC_SATS must be greater than zero.");
  }
  const whole = value / 100n;
  const remainder = value % 100n;
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, "0")}`;
}

function assertPositiveAtomAmount(value: string, name: string): void {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new AppError(500, `${name} must be a positive integer.`);
  }
}

function normalizeStarterAddress(raw: unknown): string {
  const address = typeof raw === "string" ? raw.trim() : "";
  const lowered = address.toLowerCase();

  if (!address) {
    throw new AppError(400, "Address is required.");
  }
  if (lowered.startsWith("tokenaddr:")) {
    throw new AppError(400, "Use an ecash: address, not tokenaddr:.");
  }
  if (!lowered.startsWith("ecash:")) {
    throw new AppError(400, "Address must be a valid ecash: address.");
  }
  if (!isValidEcashAddress(lowered)) {
    throw new AppError(400, "Address must be a valid ecash: address.");
  }

  return lowered;
}

function cooldownSinceIso(): string {
  return new Date(Date.now() - config.faucetCooldownDays * 24 * 60 * 60 * 1000).toISOString();
}

function dryRunTxid(kind: "xec" | "rmz"): string {
  return `dryrun-${kind}-${crypto.randomUUID().replace(/-/g, "")}`;
}

function starterPackPayload() {
  const xecSats = config.starterXecSats;
  assertPositiveAtomAmount(xecSats, "STARTER_XEC_SATS");
  assertPositiveAtomAmount(config.starterRmzAtoms, "STARTER_RMZ_ATOMS");

  return {
    xecSats,
    xec: xecFromSats(xecSats),
    rmzAtoms: config.starterRmzAtoms
  };
}

function starterSuccessResponse(address: string, xecTxid: string, rmzTxid: string) {
  return {
    ok: true,
    address,
    starterPack: starterPackPayload(),
    txids: {
      xec: xecTxid,
      rmz: rmzTxid
    },
    dryRun: config.faucetDryRun,
    nextSteps: [
      "Open Tonalli Wallet",
      "Register your .xec alias",
      "Verify your identity at https://ecash.mx/identidad"
    ]
  };
}

function sendStarterError(res: { status(code: number): { json(body: unknown): void } }, error: unknown): void {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError && error.expose ? error.message : "Internal error";
  console.error(serverErrorMessage(error));
  res.status(statusCode).json({ ok: false, error: message });
}

faucetRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tonalli-faucet-api",
    starterPackEnabled: config.faucetEnabled,
    dryRun: config.faucetDryRun,
    turnstileEnabled: config.turnstileEnabled,
    cooldownDays: config.faucetCooldownDays,
    twitterGateEnabled: config.twitterGateEnabled,
    twitterTargetTweetUrl: config.twitterTargetTweetUrl || undefined,
    starterPack: starterPackPayload()
  });
});

faucetRouter.get("/stats", (_req, res) => {
  res.json(getStarterPackStats());
});

faucetRouter.post("/starter-pack", ipClaimLimiter, addressLimiter, async (req, res, next) => {
  const now = new Date().toISOString();
  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "";
  let claimId: number | null = null;
  let xecTxid: string | null = null;

  try {
    if (!config.faucetEnabled) {
      throw new AppError(503, "Faucet is temporarily disabled.");
    }

    const address = normalizeStarterAddress(req.body?.address);
    const turnstileToken = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken : undefined;
    await verifyTurnstileToken(turnstileToken, req.ip);

    const since = cooldownSinceIso();
    if (getRecentStarterPackClaimByAddress(address, since)) {
      throw new AppError(429, "Address already received a starter pack recently.");
    }
    if (getRecentStarterPackClaimByIpHash(ipHash, since)) {
      throw new AppError(429, "IP already used for starter pack recently.");
    }

    const starterPack = starterPackPayload();

    if (config.faucetDryRun) {
      const dryRunXecTxid = dryRunTxid("xec");
      const dryRunRmzTxid = dryRunTxid("rmz");
      insertStarterPackClaim({
        address,
        ipHash,
        userAgent,
        createdAt: now,
        xecTxid: dryRunXecTxid,
        rmzTxid: dryRunRmzTxid,
        status: "dry_run_completed",
        dryRun: true
      });
      res.json(starterSuccessResponse(address, dryRunXecTxid, dryRunRmzTxid));
      return;
    }

    claimId = insertStarterPackClaim({
      address,
      ipHash,
      userAgent,
      createdAt: now,
      status: "pending",
      dryRun: false
    });

    xecTxid = await sendXecToAddress(address, starterPack.xec);
    updateStarterPackClaim({ id: claimId, xecTxid, status: "xec_sent" });

    const rmzTxid = await sendRmzToAddress(address, starterPack.rmzAtoms);
    updateStarterPackClaim({ id: claimId, xecTxid, rmzTxid, status: "completed" });

    res.json(starterSuccessResponse(address, xecTxid, rmzTxid));
  } catch (error) {
    if (claimId !== null) {
      updateStarterPackClaim({ id: claimId, xecTxid, status: "failed" });
    }
    if (error instanceof AppError) {
      sendStarterError(res, error);
      return;
    }
    next(error);
  }
});

faucetRouter.post("/claim", ipClaimLimiter, addressLimiter, async (req, res, next) => {
  const now = new Date().toISOString();
  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const eventCode = cleanEventCode(req.body?.eventCode);
  let rmzGateRequired = false;
  let rmzGatePassed = false;
  let twitterUserId: string | null = null;
  let hasSocialReservation = false;

  try {
    if (!config.faucetEnabled) {
      throw new AppError(503, "La faucet esta deshabilitada temporalmente.");
    }
    if (!address) {
      throw new AppError(400, "La direccion eCash es requerida.");
    }
    if (!isValidEcashAddress(address)) {
      throw new AppError(400, "La direccion eCash no es valida.");
    }
    if (config.eventCodeRequired && eventCode !== config.eventCode) {
      throw new AppError(403, "Codigo de evento invalido.");
    }

    const existing = getClaim(address);
    assertCooldown(existing?.last_claim_at ?? null);

    const previousClaims = existing?.claim_count ?? 0;
    rmzGateRequired = previousClaims >= config.maxClaimsWithoutRmz;

    if (rmzGateRequired) {
      rmzGatePassed = await verifyRmzGate(address);
      if (!rmzGatePassed) {
        throw new AppError(403, "Para reclamar por segunda vez necesitas al menos 1 RMZ en tu Tonalli Wallet.");
      }
    }

    if (config.twitterGateEnabled) {
      const twitterHandle = cleanTwitterHandle(req.body?.twitterHandle);
      const twitterCheck = await verifyRetweetAndGetUserId(twitterHandle, config.twitterTargetTweetId);
      if (!twitterCheck.hasRetweeted) {
        throw new AppError(403, "No encontramos tu repost. Por favor haz repost al post oficial e intenta de nuevo.");
      }

      twitterUserId = twitterCheck.userId;
      const reservation = reserveSocialClaim({
        provider: "x",
        providerUserId: twitterUserId,
        handle: twitterHandle,
        targetTweetId: config.twitterTargetTweetId,
        address,
        createdAt: now
      });

      if (!reservation.ok) {
        throw new AppError(403, "Esta cuenta de X ya reclamó la recompensa o tiene un cobro en proceso.");
      }
      hasSocialReservation = true;
    }

    let txid: string;
    try {
      txid = await sendXecToAddress(address, config.claimAmountXec);
    } catch (error) {
      if (hasSocialReservation && twitterUserId) {
        markSocialClaimNeedsReview("x", twitterUserId, config.twitterTargetTweetId, errorMessage(error));
      }
      throw error;
    }

    if (hasSocialReservation && twitterUserId) {
      completeSocialClaim("x", twitterUserId, config.twitterTargetTweetId, txid, now);
    }

    const claimCount = upsertClaim({ address, txid, ipHash, rmzGatePassed, now });

    insertClaimEvent({
      address,
      txid,
      ipHash,
      userAgent,
      amountXec: config.claimAmountXec,
      eventCode,
      rmzGateRequired,
      rmzGatePassed,
      createdAt: now,
      status: "ok"
    });

    res.json({
      status: "ok",
      txid,
      claimCount,
      rmzGateRequired,
      rmzGatePassed
    });
  } catch (error) {
    insertClaimEvent({
      address: address || "unknown",
      ipHash,
      userAgent,
      amountXec: config.claimAmountXec,
      eventCode,
      rmzGateRequired,
      rmzGatePassed,
      createdAt: now,
      status: "error",
      error: errorMessage(error)
    });
    next(error);
  }
});
