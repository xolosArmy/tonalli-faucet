import dotenv from "dotenv";
export const DEFAULT_RMZ_TOKEN_ID = "c923bd0f09c630c5e9980cf518c8d34b6353802a3cb7c3f34fa7cc85c9305908";
export const DEFAULT_CHRONIK_URL = "https://chronik.xolosarmy.xyz";
dotenv.config();
function required(name) {
    const value = process.env[name];
    if (value && value.trim() !== "") {
        return value;
    }
    if ((process.env.NODE_ENV ?? "development") !== "production") {
        return `dev-placeholder-${name}`;
    }
    throw new Error(`Missing required environment variable: ${name}`);
}
function optional(name, fallback) {
    const value = process.env[name];
    return value && value.trim() !== "" ? value : fallback;
}
function numberEnv(name, fallback) {
    const raw = optional(name, String(fallback));
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric environment variable: ${name}`);
    }
    return parsed;
}
function boolEnv(name, fallback) {
    const raw = optional(name, String(fallback));
    return raw.toLowerCase() === "true";
}
export const config = {
    port: numberEnv("PORT", 3001),
    nodeEnv: optional("NODE_ENV", "development"),
    corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),
    sqlitePath: optional("SQLITE_PATH", "./data/faucet.sqlite"),
    claimAmountXec: optional("CLAIM_AMOUNT_XEC", "500"),
    maxClaimsWithoutRmz: numberEnv("MAX_CLAIMS_WITHOUT_RMZ", 1),
    eventCodeRequired: boolEnv("EVENT_CODE_REQUIRED", true),
    eventCode: optional("EVENT_CODE", "TONALLI-CU"),
    rateLimitWindowMs: numberEnv("RATE_LIMIT_WINDOW_MS", 900000),
    rateLimitMax: numberEnv("RATE_LIMIT_MAX", 20),
    addressCooldownHours: numberEnv("ADDRESS_COOLDOWN_HOURS", 24),
    rmzTokenId: optional("RMZ_TOKEN_ID", DEFAULT_RMZ_TOKEN_ID),
    chronikUrl: optional("CHRONIK_URL", DEFAULT_CHRONIK_URL),
    bitcoinAbcRpcUrl: required("BITCOIN_ABC_RPC_URL"),
    bitcoinAbcRpcUser: required("BITCOIN_ABC_RPC_USER"),
    bitcoinAbcRpcPass: required("BITCOIN_ABC_RPC_PASS"),
    faucetEnabled: boolEnv("FAUCET_ENABLED", true),
    ipHashSecret: required("IP_HASH_SECRET")
};
export const isProduction = config.nodeEnv === "production";
