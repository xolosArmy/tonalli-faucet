import dotenv from "dotenv";
import { parseBitcoinAbcRpcConfig } from "./utils/rpcConfig.js";

export const DEFAULT_RMZ_TOKEN_ID = "c923bd0f09c630c5e9980cf518c8d34b6353802a3cb7c3f34fa7cc85c9305908";
export const DEFAULT_CHRONIK_URL = "https://chronik.xolosarmy.xyz";
export const DEFAULT_ALLOWED_ORIGIN = [
  "https://ecash.mx",
  "https://cartera.xolosarmy.xyz",
  "https://app.tonalli.cash",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
].join(",");

dotenv.config();

let bitcoinAbcRpc: ReturnType<typeof parseBitcoinAbcRpcConfig>;
try {
  bitcoinAbcRpc = parseBitcoinAbcRpcConfig(
    process.env.BITCOIN_ABC_RPC_URL,
    process.env.BITCOIN_ABC_RPC_USER,
    process.env.BITCOIN_ABC_RPC_PASS
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Bitcoin ABC RPC configuration is invalid.";
  console.error(`[startup] ${message}`);
  throw error;
}

function required(name: string): string {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value;
  }
  if ((process.env.NODE_ENV ?? "development") !== "production") {
    return `dev-placeholder-${name}`;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function listEnv(name: string, fallback: string): string[] {
  return optional(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberEnv(name: string, fallback: number): number {
  const raw = optional(name, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = optional(name, String(fallback));
  return raw.toLowerCase() === "true";
}

export const config = {
  port: numberEnv("PORT", 3015),
  nodeEnv: optional("NODE_ENV", "development"),
  corsOrigins: listEnv("ALLOWED_ORIGIN", process.env.CORS_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN),
  sqlitePath: optional("FAUCET_DB_PATH", process.env.SQLITE_PATH ?? "data/faucet.sqlite"),
  claimAmountXec: optional("CLAIM_AMOUNT_XEC", "500"),
  maxClaimsWithoutRmz: numberEnv("MAX_CLAIMS_WITHOUT_RMZ", 1),
  eventCodeRequired: boolEnv("EVENT_CODE_REQUIRED", true),
  eventCode: optional("EVENT_CODE", "TONALLI-CU"),
  rateLimitWindowMs: numberEnv("RATE_LIMIT_WINDOW_MS", 900000),
  rateLimitMax: numberEnv("RATE_LIMIT_MAX", 20),
  ipClaimLimitWindowMs: numberEnv("IP_CLAIM_LIMIT_WINDOW_MS", 3600000),
  ipClaimLimitMax: numberEnv("IP_CLAIM_LIMIT_MAX", 5),
  addressCooldownHours: numberEnv("ADDRESS_COOLDOWN_HOURS", 24),
  rmzTokenId: optional("RMZ_TOKEN_ID", DEFAULT_RMZ_TOKEN_ID),
  chronikUrl: optional("CHRONIK_URL", DEFAULT_CHRONIK_URL),
  bitcoinAbcRpcUrl: bitcoinAbcRpc.url,
  bitcoinAbcRpcUser: bitcoinAbcRpc.user,
  bitcoinAbcRpcPass: bitcoinAbcRpc.pass,
  faucetEnabled: boolEnv("FAUCET_ENABLED", true),
  faucetDryRun: boolEnv("FAUCET_DRY_RUN", true),
  faucetMnemonic: optional("FAUCET_MNEMONIC", ""),
  starterXecSats: optional("STARTER_XEC_SATS", "100000"),
  starterRmzAtoms: optional("STARTER_RMZ_ATOMS", "1"),
  turnstileEnabled: boolEnv("TURNSTILE_ENABLED", false),
  turnstileSecretKey: optional("TURNSTILE_SECRET_KEY", ""),
  faucetCooldownDays: numberEnv("FAUCET_COOLDOWN_DAYS", 30),
  ipHashSecret: required("IP_HASH_SECRET")
} as const;

export const isProduction = config.nodeEnv === "production";
