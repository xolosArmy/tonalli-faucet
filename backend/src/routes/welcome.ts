import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { config } from "../config.js";
import {
  completeWelcomeClaim,
  getWelcomeClaim,
  getWelcomeClaimStats,
  markWelcomeClaimFailedRetryable,
  markWelcomeClaimNeedsReview,
  reserveWelcomeClaim,
  type WelcomeClaimRow
} from "../welcomeClaims.js";
import { isBitcoinAbcRpcError, sendXecToAddress } from "../services/bitcoinAbcRpc.js";
import { verifyTurnstileToken } from "../services/turnstile.js";
import { AppError, serverErrorMessage } from "../utils/errors.js";
import { hashIp } from "../utils/ipHash.js";
import {
  WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE,
  isWelcomeQuickStartCompatible
} from "../welcomeQuickStartPolicy.js";

export const welcomeRouter = Router();

const welcomeIpLimiter = rateLimit({
  windowMs: config.ipClaimLimitWindowMs,
  limit: config.ipClaimLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, status: "rate_limited", error: "Limite de reclamos por red alcanzado. Intenta mas tarde." }
});

const welcomeAddressLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const address = typeof req.body?.address === "string" ? req.body.address.trim().toLowerCase() : "unknown";
    return `${req.ip}:${address}`;
  },
  message: { ok: false, status: "rate_limited", error: "Demasiados intentos. Intenta de nuevo mas tarde." }
});

function normalizeAddress(raw: unknown): string {
  const address = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!address) throw new AppError(400, "Address is required.");
  if (address.startsWith("tokenaddr:")) {
    throw new AppError(400, "Use an ecash: address, not tokenaddr:.");
  }
  if (!address.startsWith("ecash:") || !isValidEcashAddress(address)) {
    throw new AppError(400, "Address must be a valid ecash: address.");
  }
  return address;
}

function xecFromSats(sats: string): string {
  if (!/^\d+$/.test(sats) || BigInt(sats) <= 0n) {
    throw new AppError(500, "STARTER_XEC_SATS must be a positive integer.");
  }
  const value = BigInt(sats);
  const whole = value / 100n;
  const remainder = value % 100n;
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, "0")}`;
}

function starterPackPayload() {
  return {
    xecSats: config.starterXecSats,
    xec: xecFromSats(config.starterXecSats)
  };
}

function publicClaimState(claim: WelcomeClaimRow) {
  if (claim.status === "completed" || claim.status === "dry_run_completed") {
    return {
      ok: true,
      status: "already_claimed",
      address: claim.address,
      starterPack: starterPackPayload(),
      txid: claim.xecTxid,
      dryRun: claim.dryRun === 1
    };
  }

  if (claim.status === "pending" || claim.status === "needs_review") {
    return {
      ok: false,
      status: "pending_review",
      address: claim.address,
      starterPack: starterPackPayload(),
      txid: claim.xecTxid,
      dryRun: claim.dryRun === 1,
      message: "El reclamo ya esta en proceso o requiere conciliacion. No se enviara otra transferencia automaticamente."
    };
  }

  return {
    ok: false,
    status: "retryable",
    address: claim.address,
    starterPack: starterPackPayload(),
    dryRun: claim.dryRun === 1
  };
}

function sendPublicError(
  res: { status(code: number): { json(body: unknown): void } },
  error: unknown
): void {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError && error.expose ? error.message : "Internal error";
  console.error(serverErrorMessage(error));
  res.status(statusCode).json({ ok: false, status: "error", error: message });
}

welcomeRouter.get("/starter-pack/status", (req, res) => {
  try {
    const address = normalizeAddress(req.query.address);
    const claim = getWelcomeClaim(address);
    if (!claim) {
      res.json({
        ok: true,
        status: "available",
        address,
        starterPack: starterPackPayload(),
        dryRun: config.faucetDryRun
      });
      return;
    }
    const state = publicClaimState(claim);
    res.status(state.status === "pending_review" ? 202 : 200).json(state);
  } catch (error) {
    sendPublicError(res, error);
  }
});

welcomeRouter.get("/starter-pack/config", (_req, res) => {
  const quickStartCompatible = isWelcomeQuickStartCompatible({
    turnstileEnabled: config.turnstileEnabled
  });
  res.json({
    ok: true,
    enabled: config.faucetEnabled,
    oneTimePerAddress: true,
    dryRun: config.faucetDryRun,
    turnstileRequired: config.turnstileEnabled,
    quickStartCompatible,
    starterPack: starterPackPayload()
  });
});

welcomeRouter.get("/starter-pack/stats", (_req, res) => {
  res.json(getWelcomeClaimStats());
});

welcomeRouter.post("/starter-pack", welcomeIpLimiter, welcomeAddressLimiter, async (req, res, next) => {
  const now = new Date().toISOString();
  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "";
  let address: string;

  try {
    if (!config.faucetEnabled) {
      throw new AppError(503, "Faucet is temporarily disabled.");
    }

    if (!isWelcomeQuickStartCompatible({ turnstileEnabled: config.turnstileEnabled })) {
      throw new AppError(503, WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE);
    }

    address = normalizeAddress(req.body?.address);
    const turnstileToken = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken : undefined;
    await verifyTurnstileToken(turnstileToken, req.ip);

    const reservation = reserveWelcomeClaim({
      address,
      ipHash,
      userAgent,
      now,
      dryRun: config.faucetDryRun
    });

    if (reservation.kind === "existing") {
      const state = publicClaimState(reservation.claim);
      res.status(state.status === "pending_review" ? 202 : 200).json(state);
      return;
    }

    if (config.faucetDryRun) {
      const txid = `dryrun-xec-${crypto.randomUUID().replace(/-/g, "")}`;
      completeWelcomeClaim({ address, txid, now: new Date().toISOString(), dryRun: true });
      res.json({
        ok: true,
        status: "completed",
        address,
        starterPack: starterPackPayload(),
        txid,
        dryRun: true
      });
      return;
    }

    try {
      const txid = await sendXecToAddress(address, starterPackPayload().xec);
      const completed = completeWelcomeClaim({
        address,
        txid,
        now: new Date().toISOString(),
        dryRun: false
      });
      if (!completed) {
        markWelcomeClaimNeedsReview({
          address,
          txid,
          now: new Date().toISOString(),
          error: "Broadcast returned a txid but the pending reservation could not be finalized."
        });
        res.status(202).json({
          ok: false,
          status: "pending_review",
          address,
          starterPack: starterPackPayload(),
          txid,
          dryRun: false,
          message: "La transferencia fue emitida pero su registro local requiere conciliacion. No se volvera a enviar automaticamente."
        });
        return;
      }

      res.json({
        ok: true,
        status: "completed",
        address,
        starterPack: starterPackPayload(),
        txid,
        dryRun: false
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      if (isBitcoinAbcRpcError(error) && !error.broadcastMayHaveOccurred) {
        markWelcomeClaimFailedRetryable({ address, now: failedAt, error: error.internalDetail });
        sendPublicError(res, error);
        return;
      }

      const internalDetail = isBitcoinAbcRpcError(error)
        ? error.internalDetail
        : "Unexpected error after welcome claim reservation; broadcast status is unknown.";
      markWelcomeClaimNeedsReview({ address, now: failedAt, error: internalDetail });
      res.status(202).json({
        ok: false,
        status: "pending_review",
        address,
        starterPack: starterPackPayload(),
        dryRun: false,
        message: "No pudimos confirmar el resultado del envio. Tonalli no realizara otra transferencia hasta conciliar este reclamo."
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      sendPublicError(res, error);
      return;
    }
    next(error);
  }
});
