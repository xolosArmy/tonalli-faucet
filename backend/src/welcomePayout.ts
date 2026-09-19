import { AppError } from "./utils/errors.js";

export const MAX_WELCOME_RPC_XEC = Number.MAX_SAFE_INTEGER;

export type WelcomePayout = {
  xecSats: string;
  xec: string;
  rpcAmount: number;
};

export function parseWelcomePayout(rawSats: string): WelcomePayout {
  if (typeof rawSats !== "string" || !/^\d+$/.test(rawSats)) {
    throw new AppError(500, "STARTER_XEC_SATS must be a positive integer.");
  }

  const sats = BigInt(rawSats);
  if (sats <= 0n) {
    throw new AppError(500, "STARTER_XEC_SATS must be a positive integer.");
  }

  const whole = sats / 100n;
  const remainder = sats % 100n;
  const xec = remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, "0")}`;
  const rpcAmount = Number(xec);

  if (
    !Number.isFinite(rpcAmount)
    || rpcAmount <= 0
    || rpcAmount > MAX_WELCOME_RPC_XEC
    || Number.isNaN(rpcAmount)
  ) {
    throw new AppError(500, "STARTER_XEC_SATS exceeds the finite RPC amount limit.");
  }

  return {
    xecSats: rawSats,
    xec,
    rpcAmount
  };
}
