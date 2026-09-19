import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { AppError } from "../utils/errors.js";

process.env.BITCOIN_ABC_RPC_URL = "http://rpc-user:rpc-pass@127.0.0.1:8332";
process.env.FAUCET_DB_PATH = `/tmp/tonalli-faucet-test-${process.pid}.sqlite`;
process.env.FAUCET_ENABLED = "true";
process.env.FAUCET_DRY_RUN = "false";
process.env.EVENT_CODE_REQUIRED = "false";
process.env.ADDRESS_COOLDOWN_HOURS = "0";
process.env.RATE_LIMIT_MAX = "1000";
process.env.IP_CLAIM_LIMIT_MAX = "1000";
process.env.TELEGRAM_GATE_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_BOT_USERNAME = "tonalli_test_bot";
process.env.TELEGRAM_TARGET_CHAT_ID = "-1001234567890";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.IP_HASH_SECRET = "test-ip-hash-secret";

const { db, completeSocialClaim, createSocialAuthSession, insertStarterPackClaim, markSocialClaimFailed, markSocialClaimNeedsReview, reserveSocialClaim, verifySocialAuthSession } = await import("../db.js");
const { completeWelcomeClaim, reserveWelcomeClaim } = await import("../welcomeClaims.js");
const { faucetRouter } = await import("./faucet.js");
const { FAUCET_MAINTENANCE_MESSAGE } = await import("../services/bitcoinAbcRpc.js");

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const address = "ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3";
const targetId = process.env.TELEGRAM_TARGET_CHAT_ID!;

type RpcScenario =
  | { kind: "reject"; error: unknown }
  | { kind: "response"; response: Response };

let rpcScenario: RpcScenario | null = null;

const app = express();
app.use(express.json());
app.use("/v1/faucet", faucetRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const publicMessage = error instanceof AppError && error.expose ? error.message : "Error interno";
  res.status(statusCode).json({ error: publicMessage, detail: publicMessage });
});

const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

console.error = () => {};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("https://api.telegram.org/")) {
    return Response.json({ ok: true, result: { status: "member" } });
  }
  if (!rpcScenario) {
    throw new Error("Missing RPC scenario");
  }
  if (rpcScenario.kind === "reject") {
    throw rpcScenario.error;
  }
  return rpcScenario.response;
}) as typeof fetch;

beforeEach(() => {
  db.exec("DELETE FROM claim_events; DELETE FROM claims; DELETE FROM social_auth_sessions; DELETE FROM social_claims; DELETE FROM welcome_claims; DELETE FROM starter_pack_claims;");
  rpcScenario = null;
});

after(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  server.close();
  // Do not db.close() here. Node 24's test runner tears down the isolate
  // while better-sqlite3 Statement wrappers still hold cleanup hooks;
  // closing the Database then aborting the isolate hits
  // RemoveEnvironmentCleanupHook with env == nullptr (SIGABRT).
});

function responseJson(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function rpcCode(code: number, message: string): RpcScenario {
  return { kind: "response", response: responseJson({ result: null, error: { code, message }, id: "tonalli-faucet-send" }, 500) };
}

function connectionError(code: string): Error & { code: string } {
  const error = new Error(`${code} http://rpc-user:rpc-pass@127.0.0.1:8332 wallet detail`);
  return Object.assign(error, { code });
}

async function createTelegramSession(userId: string): Promise<string> {
  const nonce = `nonce-${userId}`;
  const now = new Date().toISOString();
  createSocialAuthSession({
    nonce,
    provider: "telegram",
    address,
    targetId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(verifySocialAuthSession({ nonce, providerUserId: userId, handle: `user-${userId}`, verifiedAt: now }), true);
  return nonce;
}

async function claimWithScenario(userId: string, scenario: RpcScenario): Promise<{ status: number; body: Record<string, unknown> }> {
  rpcScenario = scenario;
  const nonce = await createTelegramSession(userId);
  const response = await originalFetch(`${baseUrl}/v1/faucet/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, provider: "telegram", telegramNonce: nonce })
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function socialClaim(userId: string): { status: string; txid: string | null; error: string | null; completed_at: string | null } {
  return db.prepare(`
    SELECT status, txid, error, completed_at FROM social_claims
    WHERE provider = 'telegram' AND provider_user_id = ? AND target_id = ?
  `).get(userId, targetId) as { status: string; txid: string | null; error: string | null; completed_at: string | null };
}

test("ECONNREFUSED termina en failed y no filtra detalle RPC al HTTP publico", async () => {
  const result = await claimWithScenario("1001", { kind: "reject", error: connectionError("ECONNREFUSED") });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, FAUCET_MAINTENANCE_MESSAGE);
  assert.equal(JSON.stringify(result.body).includes("rpc-user"), false);
  assert.equal(JSON.stringify(result.body).includes("rpc-pass"), false);
  assert.equal(JSON.stringify(result.body).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(result.body).includes("ECONNREFUSED"), false);

  const row = socialClaim("1001");
  assert.equal(row.status, "failed");
  assert.equal(row.txid, null);
  assert.equal(row.completed_at, null);
});

test("RPC -6 termina en failed", async () => {
  const result = await claimWithScenario("1002", rpcCode(-6, "Insufficient funds"));

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1002").status, "failed");
});

test("RPC -18 termina en failed", async () => {
  const result = await claimWithScenario("1003", rpcCode(-18, "Requested wallet does not exist or is not loaded"));

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1003").status, "failed");
});

test("timeout termina en needs_review", async () => {
  const error = connectionError("ETIMEDOUT");
  error.message = "request timed out";
  const result = await claimWithScenario("1004", { kind: "reject", error });

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1004").status, "needs_review");
});

test("JSON invalido despues de HTTP 200 termina en needs_review", async () => {
  const result = await claimWithScenario("1005", {
    kind: "response",
    response: new Response("{", { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1005").status, "needs_review");
});

test("respuesta sin TXID termina en needs_review", async () => {
  const result = await claimWithScenario("1006", responseScenario({ result: null, error: null, id: "tonalli-faucet-send" }));

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1006").status, "needs_review");
});

test("un registro failed puede reservarse de nuevo", () => {
  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2001", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, true);
  markSocialClaimFailed("telegram", "2001", targetId, "definitive failure");

  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2001", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, true);
  assert.equal(socialClaim("2001").status, "pending");
});

test("un registro needs_review sigue bloqueando otro intento", () => {
  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2002", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, true);
  markSocialClaimNeedsReview("telegram", "2002", targetId, "ambiguous failure");

  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2002", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, false);
  assert.equal(socialClaim("2002").status, "needs_review");
});

test("ENOTFOUND termina en failed", async () => {
  const result = await claimWithScenario("1008", { kind: "reject", error: connectionError("ENOTFOUND") });

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1008").status, "failed");
});

test("EAI_AGAIN termina en failed", async () => {
  const result = await claimWithScenario("1009", { kind: "reject", error: connectionError("EAI_AGAIN") });

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1009").status, "failed");
});

test("HTTP 401 termina en failed y solo expone mensaje publico de mantenimiento", async () => {
  const result = await claimWithScenario("1010", { kind: "response", response: responseJson({ error: "unauthorized" }, 401) });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, FAUCET_MAINTENANCE_MESSAGE);
  assert.equal(result.body.detail, FAUCET_MAINTENANCE_MESSAGE);
  assert.equal(socialClaim("1010").status, "failed");
});

test("HTTP 403 termina en failed", async () => {
  const result = await claimWithScenario("1011", { kind: "response", response: responseJson({ error: "forbidden" }, 403) });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, FAUCET_MAINTENANCE_MESSAGE);
  assert.equal(socialClaim("1011").status, "failed");
});

test("ECONNRESET termina en needs_review", async () => {
  const result = await claimWithScenario("1012", { kind: "reject", error: connectionError("ECONNRESET") });

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1012").status, "needs_review");
});

test("RPC -32603 termina en needs_review", async () => {
  const result = await claimWithScenario("1013", rpcCode(-32603, "Internal wallet error"));

  assert.equal(result.status, 503);
  assert.equal(socialClaim("1013").status, "needs_review");
});

test("completed no puede degradarse a failed y conserva txid y completed_at", () => {
  const completedAt = "2026-07-08T12:00:00.000Z";
  const txid = "completed-txid";
  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2003", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, true);
  completeSocialClaim("telegram", "2003", targetId, txid, completedAt);

  markSocialClaimFailed("telegram", "2003", targetId, "late failure");

  const row = socialClaim("2003");
  assert.equal(row.status, "completed");
  assert.equal(row.txid, txid);
  assert.equal(row.completed_at, completedAt);
});

test("completed no puede degradarse a needs_review", () => {
  const completedAt = "2026-07-08T12:01:00.000Z";
  const txid = "completed-review-txid";
  assert.equal(reserveSocialClaim({ provider: "telegram", providerUserId: "2004", handle: "user", targetId, address, createdAt: new Date().toISOString() }).ok, true);
  completeSocialClaim("telegram", "2004", targetId, txid, completedAt);

  markSocialClaimNeedsReview("telegram", "2004", targetId, "late ambiguous failure");

  const row = socialClaim("2004");
  assert.equal(row.status, "completed");
  assert.equal(row.txid, txid);
  assert.equal(row.completed_at, completedAt);
});

test("IP privada aislada queda redactada en detalle interno RPC", async () => {
  const privateIps = ["10.10.0.2", "127.0.0.1", "169.254.1.2", "172.16.0.4", "172.31.255.254", "192.168.1.20"];
  const result = await claimWithScenario("1014", rpcCode(-32603, `Backend peers ${privateIps.join(" ")}`));

  assert.equal(result.status, 503);
  const row = socialClaim("1014");
  assert.equal(row.status, "needs_review");
  for (const ip of privateIps) {
    assert.equal(row.error?.includes(ip), false);
  }
  assert.equal(row.error?.includes("[redacted-ip]"), true);
});

test("error desconocido despues de reserva social no almacena secretos", async () => {
  const secret = "rpc-user:rpc-pass http://rpc-user:rpc-pass@10.10.0.2:8332 stack trace credential";
  const result = await claimWithScenario("1015", { kind: "reject", error: new Error(secret) });

  assert.equal(result.status, 503);
  const row = socialClaim("1015");
  assert.equal(row.status, "needs_review");
  assert.equal(row.error?.includes("rpc-user"), false);
  assert.equal(row.error?.includes("rpc-pass"), false);
  assert.equal(row.error?.includes("10.10.0.2"), false);
  assert.equal(row.error?.includes("http://"), false);
  const event = db.prepare("SELECT error FROM claim_events WHERE address = ? ORDER BY id DESC LIMIT 1").get(address) as { error: string | null };
  assert.equal(event.error, FAUCET_MAINTENANCE_MESSAGE);
});


test("un TXID valido termina en completed", async () => {
  const txid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const result = await claimWithScenario("1007", responseScenario({ result: txid, error: null, id: "tonalli-faucet-send" }));

  assert.equal(result.status, 200);
  assert.equal(result.body.txid, txid);
  const row = socialClaim("1007");
  assert.equal(row.status, "completed");
  assert.equal(row.txid, txid);
  assert.notEqual(row.completed_at, null);
});

test("GET /health no anuncia starter pack cuando Welcome Quick Start es incompatible", async () => {
  const { config } = await import("../config.js");
  const previous = config.turnstileEnabled;
  (config as { turnstileEnabled: boolean }).turnstileEnabled = true;
  try {
    const response = await originalFetch(`${baseUrl}/v1/faucet/health`);
    const body = await response.json() as {
      starterPackEnabled: boolean;
      quickStartCompatible: boolean;
      turnstileEnabled: boolean;
    };
    assert.equal(response.status, 200);
    assert.equal(body.turnstileEnabled, true);
    assert.equal(body.quickStartCompatible, false);
    assert.equal(body.starterPackEnabled, false);
  } finally {
    (config as { turnstileEnabled: boolean }).turnstileEnabled = previous;
  }
});

test("GET /stats agrega welcome, legacy starter pack y social", async () => {
  const now = new Date().toISOString();
  insertStarterPackClaim({
    address,
    ipHash: "legacy-stats",
    createdAt: now,
    xecTxid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    status: "completed",
    dryRun: false
  });
  const welcomeAddress = "ecash:qz2708636snqhsxu8wnlka78h6fdp77ar59j2t0fh2";
  reserveWelcomeClaim({
    address: welcomeAddress,
    ipHash: "welcome-stats",
    now,
    dryRun: false
  });
  completeWelcomeClaim({
    address: welcomeAddress,
    txid: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    now,
    dryRun: false
  });
  const dryAddress = "ecash:qracc65ppv9x2k0g0h9l5v3n7w8q0r1s2t3u4v5w6x7";
  reserveWelcomeClaim({
    address: dryAddress,
    ipHash: "dry-stats",
    now,
    dryRun: true
  });
  completeWelcomeClaim({
    address: dryAddress,
    txid: "dryrun-xec-statsfixtureaaaaaaaaaaaaaaaaaaaaaaaa",
    now,
    dryRun: true
  });

  const response = await originalFetch(`${baseUrl}/v1/faucet/stats`);
  const body = await response.json() as {
    social: { total: number };
    legacyStarterPack: { completedClaims: number };
    welcome: { completed: number; dryRun: number; total: number };
  };

  assert.equal(response.status, 200);
  assert.equal(body.legacyStarterPack.completedClaims, 1);
  assert.equal(body.welcome.completed, 1);
  assert.equal(body.welcome.dryRun, 1);
  assert.equal(body.welcome.total, 2);
  assert.ok("total" in body.social);
});

function responseScenario(payload: unknown): RpcScenario {
  return { kind: "response", response: responseJson(payload) };
}
