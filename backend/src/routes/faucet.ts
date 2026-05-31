import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { config } from "../config.js";
import { getClaim, insertClaimEvent, upsertClaim } from "../db.js";
import { sendXecToAddress } from "../services/bitcoinAbcRpc.js";
import { verifyRmzGate } from "../services/rmzGate.js";
import { AppError, errorMessage } from "../utils/errors.js";
import { hashIp } from "../utils/ipHash.js";

export const faucetRouter = Router();

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

faucetRouter.post("/claim", addressLimiter, async (req, res, next) => {
  const now = new Date().toISOString();
  const ipHash = hashIp(req.ip ?? "unknown");
  const userAgent = req.get("user-agent") ?? "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const eventCode = cleanEventCode(req.body?.eventCode);
  let rmzGateRequired = false;
  let rmzGatePassed = false;

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

    const txid = await sendXecToAddress(address, config.claimAmountXec);
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
