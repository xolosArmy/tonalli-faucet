import { AppError } from "./utils/errors.js";

export const MAX_WELCOME_RPC_XEC = Number.MAX_SAFE_INTEGER;

export type WelcomePayout = {
  xecSats: string;
  xec: string;
  rpcAmount: number;
};

// Read the decimal token actually emitted by JSON.stringify, without Number arithmetic.
export function rpcJsonTokenToSats(token: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(token);
  if (!match) {
    throw new AppError(500, "RPC XEC amount is not an exact two-decimal JSON number.");
  }

  const [, whole, fraction = "0"] = match;
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

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
  const fraction = remainder % 10n === 0n
    ? (remainder / 10n).toString()
    : remainder.toString().padStart(2, "0");
  const xec = remainder === 0n ? whole.toString() : `${whole}.${fraction}`;
  const rpcAmount = Number(xec);

  if (
    !Number.isFinite(rpcAmount)
    || rpcAmount <= 0
    || rpcAmount > MAX_WELCOME_RPC_XEC
    || Number.isNaN(rpcAmount)
  ) {
    throw new AppError(500, "STARTER_XEC_SATS exceeds the finite RPC amount limit.");
  }

  const rpcToken = JSON.stringify(rpcAmount);
  if (rpcJsonTokenToSats(rpcToken) !== sats) {
    throw new AppError(500, "STARTER_XEC_SATS loses satoshis in the RPC JSON amount.");
  }

  return {
    xecSats: rawSats,
    xec,
    rpcAmount
  };
}
