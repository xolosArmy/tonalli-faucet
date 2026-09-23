import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

process.env.BITCOIN_ABC_RPC_URL = "http://rpc-user:rpc-pass@127.0.0.1:8332";
process.env.FAUCET_DB_PATH = `/tmp/tonalli-welcome-test-${process.pid}.sqlite`;
process.env.FAUCET_ENABLED = "true";
process.env.FAUCET_DRY_RUN = "false";
process.env.RATE_LIMIT_MAX = "1000";
process.env.IP_CLAIM_LIMIT_MAX = "1000";
process.env.TURNSTILE_ENABLED = "false";
process.env.IP_HASH_SECRET = "welcome-test-ip-secret";
process.env.STARTER_XEC_SATS = "100000";

const { db, insertStarterPackClaim } = await import("../db.js");
const { welcomeRouter } = await import("./welcome.js");
const { AppError } = await import("../utils/errors.js");
const { config } = await import("../config.js");
const {
  adoptLegacyFundedStarterPackClaims,
  getWelcomeClaim,
  reserveWelcomeClaim
} = await import("../welcomeClaims.js");

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const address = "ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3";
const txid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const legacyTxid = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

let rpcCalls = 0;
let rpcRequestBodies: string[] = [];
let rpcHandler: (() => Promise<Response>) | null = null;

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/v1/faucet", welcomeRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError && error.expose ? error.message : "Error interno";
  res.status(statusCode).json({ error: message });
});
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

console.error = () => {};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("127.0.0.1:8332")) {
    rpcCalls += 1;
    assert.equal(typeof init?.body, "string");
    rpcRequestBodies.push(init?.body as string);
    if (!rpcHandler) throw new Error("Missing RPC handler");
    return rpcHandler();
  }
  return originalFetch(input as RequestInfo | URL, init);
}) as typeof fetch;

function setFaucetDryRun(value: boolean): boolean {
  const previous = config.faucetDryRun;
  (config as { faucetDryRun: boolean }).faucetDryRun = value;
  return previous;
}

beforeEach(() => {
  db.exec("DELETE FROM welcome_claims; DELETE FROM starter_pack_claims;");
  rpcCalls = 0;
  rpcRequestBodies = [];
  rpcHandler = null;
  setFaucetDryRun(false);
});

after(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  server.close();
});

async function claim(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await originalFetch(`${baseUrl}/v1/faucet/starter-pack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address })
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function rpcSuccess(delayMs = 0): () => Promise<Response> {
  return async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return Response.json({ result: txid, error: null, id: "tonalli-faucet-send" });
  };
}

function rpcNetworkError(code: string, message = code): () => Promise<Response> {
  return async () => {
    throw Object.assign(new Error(message), { code });
  };
}

test("primer welcome claim emite exactamente 1,000 XEC", async () => {
  rpcHandler = rpcSuccess();
  const result = await claim();

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "completed");
  assert.equal(result.body.txid, txid);
  assert.equal(rpcCalls, 1);
  assert.equal((result.body.starterPack as { xec: string }).xec, "1000");
  assert.match(rpcRequestBodies[0], /"params":\["ecash:[a-z0-9]+",1000\]/);
  const rpcRequest = JSON.parse(rpcRequestBodies[0]) as { params: [string, unknown] };
  assert.equal(typeof rpcRequest.params[1], "number");
  assert.equal(JSON.stringify(rpcRequest.params[1]), "1000");
});

test("la misma address recibe already_claimed sin una segunda transferencia", async () => {
  rpcHandler = rpcSuccess();
  const first = await claim();
  const second = await claim();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.status, "already_claimed");
  assert.equal(second.body.txid, txid);
  assert.equal(rpcCalls, 1);
});

test("dos requests concurrentes reservan una sola transferencia", async () => {
  rpcHandler = rpcSuccess(50);
  const [a, b] = await Promise.all([claim(), claim()]);

  assert.equal(rpcCalls, 1);
  assert.deepEqual(
    new Set([a.body.status, b.body.status]),
    new Set(["completed", "pending_review"])
  );
});

test("timeout ambiguo queda needs_review y un retry no vuelve a emitir", async () => {
  rpcHandler = rpcNetworkError("ETIMEDOUT", "request timed out");
  const first = await claim();
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "pending_review");
  assert.equal(rpcCalls, 1);

  rpcHandler = rpcSuccess();
  const second = await claim();
  assert.equal(second.status, 202);
  assert.equal(second.body.status, "pending_review");
  assert.equal(rpcCalls, 1);
});

test("fallo definitivo antes de broadcast queda retryable y permite un solo retry", async () => {
  rpcHandler = rpcNetworkError("ECONNREFUSED");
  const first = await claim();
  assert.equal(first.status, 503);
  assert.equal(rpcCalls, 1);

  rpcHandler = rpcSuccess();
  const second = await claim();
  assert.equal(second.status, 200);
  assert.equal(second.body.status, "completed");
  assert.equal(rpcCalls, 2);

  const third = await claim();
  assert.equal(third.body.status, "already_claimed");
  assert.equal(rpcCalls, 2);
});

test("status permite reconciliar reload sin disparar una transferencia", async () => {
  const response = await originalFetch(
    `${baseUrl}/v1/faucet/starter-pack/status?address=${encodeURIComponent(address)}`
  );
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.status, "available");
  assert.equal(rpcCalls, 0);
});

test("direccion invalida se rechaza antes de reservar o emitir", async () => {
  rpcHandler = rpcSuccess();
  const response = await originalFetch(`${baseUrl}/v1/faucet/starter-pack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "ecash:not-valid" })
  });
  assert.equal(response.status, 400);
  assert.equal(rpcCalls, 0);
  const count = db.prepare("SELECT COUNT(*) AS count FROM welcome_claims").get() as { count: number };
  assert.equal(count.count, 0);
});

test("doble click secuencial no emite una segunda transferencia", async () => {
  rpcHandler = rpcSuccess();
  const first = await claim();
  const second = await claim();
  assert.equal(first.body.status, "completed");
  assert.equal(second.body.status, "already_claimed");
  assert.equal(second.body.txid, txid);
  assert.equal(rpcCalls, 1);
});

test("respuesta perdida despues de broadcast se reconcilia sin pagar dos veces", async () => {
  rpcHandler = rpcSuccess();
  const first = await claim();
  assert.equal(first.body.status, "completed");

  const status = await originalFetch(
    `${baseUrl}/v1/faucet/starter-pack/status?address=${encodeURIComponent(address)}`
  );
  const statusBody = await status.json() as Record<string, unknown>;
  assert.equal(status.status, 200);
  assert.equal(statusBody.status, "already_claimed");
  assert.equal(statusBody.txid, txid);
  assert.equal((statusBody.starterPack as { xec: string }).xec, "1000");

  const retry = await claim();
  assert.equal(retry.body.status, "already_claimed");
  assert.equal(retry.body.txid, txid);
  assert.equal(rpcCalls, 1);
});

test("config publica la cantidad autoritativa del backend", async () => {
  const response = await originalFetch(`${baseUrl}/v1/faucet/starter-pack/config`);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.oneTimePerAddress, true);
  assert.equal((body.starterPack as { xec: string }).xec, "1000");
  assert.equal(body.turnstileRequired, false);
  assert.equal(body.quickStartCompatible, true);
  assert.equal(rpcCalls, 0);
});

test("broadcast ambiguo por conexion perdida queda needs_review", async () => {
  rpcHandler = rpcNetworkError("ECONNRESET", "socket hang up");
  const first = await claim();
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "pending_review");
  rpcHandler = rpcSuccess();
  const second = await claim();
  assert.equal(second.body.status, "pending_review");
  assert.equal(rpcCalls, 1);
});

test("txid ausente despues de RPC queda needs_review y no reintenta", async () => {
  rpcHandler = async () => Response.json({ result: null, error: null, id: "tonalli-faucet-send" });
  const first = await claim();
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "pending_review");
  rpcHandler = rpcSuccess();
  const second = await claim();
  assert.equal(second.body.status, "pending_review");
  assert.equal(rpcCalls, 1);
});

function insertLegacyFunded(params: {
  status: "completed" | "xec_sent" | "failed";
  xecTxid: string | null;
  dryRun?: boolean;
  address?: string;
}): void {
  insertStarterPackClaim({
    address: params.address ?? address,
    ipHash: "legacy-ip",
    createdAt: new Date().toISOString(),
    xecTxid: params.xecTxid,
    status: params.status,
    dryRun: params.dryRun ?? false
  });
}

function rawWelcomeClaim(): { status: string; xecTxid: string | null; dryRun: number; error: string | null } | undefined {
  return db.prepare("SELECT status, xecTxid, dryRun, error FROM welcome_claims WHERE address = ?")
    .get(address) as { status: string; xecTxid: string | null; dryRun: number; error: string | null } | undefined;
}

test("legacy completed + xecTxid se adopta como already_claimed sin RPC", async () => {
  insertLegacyFunded({ status: "completed", xecTxid: txid });
  rpcHandler = rpcSuccess();
  const result = await claim();
  assert.equal(result.body.status, "already_claimed");
  assert.equal(rpcCalls, 0);
});

test("legacy xec_sent + xecTxid se adopta como already_claimed sin RPC", async () => {
  insertLegacyFunded({ status: "xec_sent", xecTxid: txid });
  rpcHandler = rpcSuccess();
  const result = await claim();
  assert.equal(result.body.status, "already_claimed");
  assert.equal(rpcCalls, 0);
});

test("legacy failed + xecTxid se adopta como already_claimed sin RPC", async () => {
  insertLegacyFunded({ status: "failed", xecTxid: txid });
  rpcHandler = rpcSuccess();
  const result = await claim();
  assert.equal(result.body.status, "already_claimed");
  assert.equal(rpcCalls, 0);
});

test("legacy failed sin txid no se importa como funded y puede reclamar una vez", async () => {
  insertLegacyFunded({ status: "failed", xecTxid: null });
  rpcHandler = rpcSuccess();
  const result = await claim();
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "completed");
  assert.equal(rpcCalls, 1);
});

test("legacy dry-run no se importa como funded", async () => {
  insertLegacyFunded({
    status: "completed",
    xecTxid: "dryrun-xec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    dryRun: true
  });
  rpcHandler = rpcSuccess();
  const result = await claim();
  assert.equal(result.body.status, "completed");
  assert.equal(rpcCalls, 1);
});

test("adopcion legacy es idempotente y no duplica filas", async () => {
  insertLegacyFunded({ status: "completed", xecTxid: txid });
  const first = adoptLegacyFundedStarterPackClaims();
  const second = adoptLegacyFundedStarterPackClaims();
  assert.equal(first, 1);
  assert.equal(second, 0);
  const count = db.prepare("SELECT COUNT(*) AS count FROM welcome_claims").get() as { count: number };
  assert.equal(count.count, 1);
  assert.equal(getWelcomeClaim(address)?.status, "completed");
});

test("late legacy funded supersedes failed_retryable before Welcome retry", async () => {
  rpcHandler = rpcNetworkError("ECONNREFUSED");
  const failed = await claim();
  assert.equal(failed.status, 503);
  assert.equal(rawWelcomeClaim()?.status, "failed_retryable");
  assert.equal(rpcCalls, 1);

  insertLegacyFunded({ status: "failed", xecTxid: legacyTxid });
  assert.equal(rawWelcomeClaim()?.status, "failed_retryable");
  rpcHandler = rpcSuccess();
  const retry = await claim();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "already_claimed");
  assert.equal(retry.body.txid, legacyTxid);
  assert.deepEqual(rawWelcomeClaim(), { status: "completed", xecTxid: legacyTxid, dryRun: 0, error: null });
  assert.equal(rpcCalls, 1);
});

test("late legacy funded supersedes dry_run_completed before live Welcome", async () => {
  setFaucetDryRun(true);
  const dry = await claim();
  assert.equal(dry.status, 200);
  assert.equal(rawWelcomeClaim()?.status, "dry_run_completed");
  assert.equal(rpcCalls, 0);

  insertLegacyFunded({ status: "xec_sent", xecTxid: legacyTxid });
  setFaucetDryRun(false);
  rpcHandler = rpcSuccess();
  const live = await claim();
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "already_claimed");
  assert.equal(live.body.txid, legacyTxid);
  assert.deepEqual(rawWelcomeClaim(), { status: "completed", xecTxid: legacyTxid, dryRun: 0, error: null });
  assert.equal(rpcCalls, 0);
});

test("late legacy funded resolves needs_review without another RPC", async () => {
  rpcHandler = rpcNetworkError("ETIMEDOUT", "request timed out");
  const pendingReview = await claim();
  assert.equal(pendingReview.status, 202);
  assert.equal(rawWelcomeClaim()?.status, "needs_review");
  assert.equal(rpcCalls, 1);

  insertLegacyFunded({ status: "completed", xecTxid: legacyTxid });
  rpcHandler = rpcSuccess();
  const retry = await claim();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "already_claimed");
  assert.equal(retry.body.txid, legacyTxid);
  assert.deepEqual(rawWelcomeClaim(), { status: "completed", xecTxid: legacyTxid, dryRun: 0, error: null });
  assert.equal(rpcCalls, 1);
});

test("late legacy funded supersedes pending before a new reservation decision", async () => {
  const pending = reserveWelcomeClaim({
    address,
    ipHash: "welcome-test-ip",
    now: new Date().toISOString(),
    dryRun: false
  });
  assert.equal(pending.kind, "reserved");
  assert.equal(rawWelcomeClaim()?.status, "pending");

  insertLegacyFunded({ status: "completed", xecTxid: legacyTxid });
  rpcHandler = rpcSuccess();
  const retry = await claim();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "already_claimed");
  assert.equal(retry.body.txid, legacyTxid);
  assert.equal(rawWelcomeClaim()?.status, "completed");
  assert.equal(rpcCalls, 0);
});

test("existing completed Welcome keeps its txid when conflicting legacy funding appears", async () => {
  rpcHandler = rpcSuccess();
  const completed = await claim();
  assert.equal(completed.status, 200);
  assert.equal(rawWelcomeClaim()?.xecTxid, txid);
  assert.equal(rpcCalls, 1);

  insertLegacyFunded({ status: "completed", xecTxid: legacyTxid });
  const retry = await claim();
  assert.equal(retry.body.status, "already_claimed");
  assert.equal(retry.body.txid, txid);
  assert.equal(rawWelcomeClaim()?.status, "completed");
  assert.equal(rawWelcomeClaim()?.xecTxid, txid);
  assert.equal(rpcCalls, 1);
});

test("late legacy dry-run evidence does not block a failed_retryable Welcome", async () => {
  rpcHandler = rpcNetworkError("ECONNREFUSED");
  assert.equal((await claim()).status, 503);
  assert.equal(rawWelcomeClaim()?.status, "failed_retryable");

  insertLegacyFunded({ status: "completed", xecTxid: "dryrun-xec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dryRun: true });
  insertLegacyFunded({ status: "completed", xecTxid: legacyTxid, dryRun: true });
  insertLegacyFunded({ status: "completed", xecTxid: "dryrun-xec-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", dryRun: false });
  assert.equal(adoptLegacyFundedStarterPackClaims(address), 0);
  assert.equal(rawWelcomeClaim()?.status, "failed_retryable");
  rpcHandler = rpcSuccess();
  const retry = await claim();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "completed");
  assert.equal(retry.body.txid, txid);
  assert.equal(rawWelcomeClaim()?.status, "completed");
  assert.equal(rpcCalls, 2);
});

test("late legacy null and empty txids do not supersede failed_retryable", async () => {
  rpcHandler = rpcNetworkError("ECONNREFUSED");
  assert.equal((await claim()).status, 503);
  insertLegacyFunded({ status: "failed", xecTxid: null });
  insertLegacyFunded({ status: "completed", xecTxid: "" });
  assert.equal(adoptLegacyFundedStarterPackClaims(address), 0);
  assert.equal(rawWelcomeClaim()?.status, "failed_retryable");

  rpcHandler = rpcSuccess();
  const retry = await claim();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "completed");
  assert.equal(retry.body.txid, txid);
  assert.equal(rpcCalls, 2);
});

test("bulk startup adoption promotes every non-terminal state and is idempotent", () => {
  const statuses = ["failed_retryable", "dry_run_completed", "pending", "needs_review"] as const;
  const now = new Date().toISOString();
  for (const status of statuses) {
    const rowAddress = `${address}-${status}`;
    db.prepare(`
      INSERT INTO welcome_claims (address, ipHash, createdAt, updatedAt, status, dryRun, error)
      VALUES (?, 'welcome-test-ip', ?, ?, ?, ?, 'previous-error')
    `).run(rowAddress, now, now, status, status === "dry_run_completed" ? 1 : 0);
    insertLegacyFunded({ status: "completed", xecTxid: legacyTxid, address: rowAddress });
  }

  assert.equal(adoptLegacyFundedStarterPackClaims(), statuses.length);
  for (const status of statuses) {
    const row = db.prepare("SELECT status, xecTxid, dryRun, error FROM welcome_claims WHERE address = ?")
      .get(`${address}-${status}`);
    assert.deepEqual(row, { status: "completed", xecTxid: legacyTxid, dryRun: 0, error: null });
  }
  assert.equal(adoptLegacyFundedStarterPackClaims(), 0);
  assert.equal(adoptLegacyFundedStarterPackClaims(), 0);
  const count = db.prepare("SELECT COUNT(*) AS count FROM welcome_claims").get() as { count: number };
  assert.equal(count.count, statuses.length);
  assert.equal(reserveWelcomeClaim({ address: `${address}-pending`, ipHash: "welcome-test-ip", now, dryRun: false }).kind, "existing");
  assert.equal(rpcCalls, 0);
});

test("adoption selects latest real funded record despite newer unfunded legacy rows", () => {
  insertLegacyFunded({ status: "completed", xecTxid: txid });
  insertLegacyFunded({ status: "xec_sent", xecTxid: legacyTxid });
  insertLegacyFunded({ status: "completed", xecTxid: "dryrun-xec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dryRun: true });
  insertLegacyFunded({ status: "failed", xecTxid: null });
  assert.equal(adoptLegacyFundedStarterPackClaims(), 1);
  assert.equal(rawWelcomeClaim()?.status, "completed");
  assert.equal(rawWelcomeClaim()?.xecTxid, legacyTxid);
  assert.equal(rpcCalls, 0);
});

test("dry-run completed permite un claim live posterior y luego already_claimed", async () => {
  setFaucetDryRun(true);
  const dry = await claim();
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(getWelcomeClaim(address)?.status, "dry_run_completed");
  assert.equal(rpcCalls, 0);

  setFaucetDryRun(false);
  rpcHandler = rpcSuccess();
  const live = await claim();
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "completed");
  assert.equal(live.body.dryRun, false);
  assert.equal(rpcCalls, 1);

  const again = await claim();
  assert.equal(again.body.status, "already_claimed");
  assert.equal(rpcCalls, 1);
});

test("un completed real no vuelve a emitir al cambiar dry-run/live", async () => {
  rpcHandler = rpcSuccess();
  const live = await claim();
  assert.equal(live.body.status, "completed");
  assert.equal(rpcCalls, 1);

  setFaucetDryRun(true);
  const dry = await claim();
  assert.equal(dry.body.status, "already_claimed");
  assert.equal(rpcCalls, 1);

  setFaucetDryRun(false);
  const again = await claim();
  assert.equal(again.body.status, "already_claimed");
  assert.equal(rpcCalls, 1);
});

test("STARTER_XEC_SATS invalido se rechaza antes de reservar", async () => {
  const previous = config.starterXecSats;
  (config as { starterXecSats: string }).starterXecSats = "0";
  rpcHandler = rpcSuccess();
  try {
    const result = await claim();
    assert.equal(result.status, 500);
    assert.equal(rpcCalls, 0);
    assert.equal(getWelcomeClaim(address), undefined);
  } finally {
    (config as { starterXecSats: string }).starterXecSats = previous;
  }
});

test("STARTER_XEC_SATS enorme se rechaza antes de reservar y no llama RPC", async () => {
  const previous = config.starterXecSats;
  const huge = `1${"0".repeat(399)}`;
  (config as { starterXecSats: string }).starterXecSats = huge;
  rpcHandler = rpcSuccess();
  try {
    const result = await claim();
    assert.equal(result.status, 500);
    assert.equal(rpcCalls, 0);
    assert.equal(getWelcomeClaim(address), undefined);
    const count = db.prepare("SELECT COUNT(*) AS n FROM welcome_claims").get() as { n: number };
    assert.equal(count.n, 0);
  } finally {
    (config as { starterXecSats: string }).starterXecSats = previous;
  }
});

test("STARTER_XEC_SATS que produce Infinity se rechaza antes de reservar", async () => {
  const previous = config.starterXecSats;
  (config as { starterXecSats: string }).starterXecSats = "9".repeat(400);
  rpcHandler = rpcSuccess();
  try {
    const result = await claim();
    assert.equal(result.status, 500);
    assert.equal(rpcCalls, 0);
    assert.equal(getWelcomeClaim(address), undefined);
  } finally {
    (config as { starterXecSats: string }).starterXecSats = previous;
  }
});

test("precision-loss config no reserva ni llama RPC; la misma address reclama con 100000 sats", async () => {
  const previous = config.starterXecSats;
  rpcHandler = rpcSuccess();
  try {
    (config as { starterXecSats: string }).starterXecSats = "900719925474099101";
    const blocked = await claim();
    assert.equal(blocked.status, 500);
    assert.equal(rpcCalls, 0);
    assert.equal(getWelcomeClaim(address), undefined);
    const count = db.prepare("SELECT COUNT(*) AS n FROM welcome_claims").get() as { n: number };
    assert.equal(count.n, 0);

    (config as { starterXecSats: string }).starterXecSats = "100000";
    const live = await claim();
    assert.equal(live.status, 200);
    assert.equal(live.body.status, "completed");
    assert.equal((live.body.starterPack as { xec: string; xecSats: string; rpcAmount: number }).xec, "1000");
    assert.equal((live.body.starterPack as { xecSats: string }).xecSats, "100000");
    assert.equal((live.body.starterPack as { rpcAmount: number }).rpcAmount, 1000);
    assert.equal(rpcCalls, 1);
    assert.match(rpcRequestBodies[0], /"params":\["ecash:[a-z0-9]+",1000\]/);
    assert.equal(getWelcomeClaim(address)?.status, "completed");
  } finally {
    (config as { starterXecSats: string }).starterXecSats = previous;
  }
});

test("carrera sobre failed_retryable reserva una sola transferencia", async () => {
  rpcHandler = rpcNetworkError("ECONNREFUSED");
  const first = await claim();
  assert.equal(first.status, 503);

  rpcHandler = rpcSuccess(40);
  const [a, b] = await Promise.all([claim(), claim()]);
  assert.equal(rpcCalls, 2);
  const statuses = new Set([a.body.status, b.body.status]);
  assert.equal(statuses.has("completed"), true);
  assert.equal(statuses.has("pending_review") || statuses.has("already_claimed"), true);
});
