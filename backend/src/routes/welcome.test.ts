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

const { db } = await import("../db.js");
const { welcomeRouter } = await import("./welcome.js");
const { AppError } = await import("../utils/errors.js");

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const address = "ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3";
const txid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let rpcCalls = 0;
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
    if (!rpcHandler) throw new Error("Missing RPC handler");
    return rpcHandler();
  }
  return originalFetch(input as RequestInfo | URL, init);
}) as typeof fetch;

beforeEach(() => {
  db.exec("DELETE FROM welcome_claims;");
  rpcCalls = 0;
  rpcHandler = null;
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
