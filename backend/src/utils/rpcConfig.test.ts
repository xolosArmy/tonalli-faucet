import assert from "node:assert/strict";
import test from "node:test";
import { parseBitcoinAbcRpcConfig } from "./rpcConfig.js";

test("parses credentials and removes them from the request URL", () => {
  const config = parseBitcoinAbcRpcConfig("http://rpc-user:rpc-pass@127.0.0.1:8332");

  assert.equal(config.url, "http://127.0.0.1:8332/");
  assert.equal(config.user, "rpc-user");
  assert.equal(config.pass, "rpc-pass");
  assert.equal(config.url.includes("rpc-pass"), false);
});

test("rejects missing, empty, and development placeholder URLs", () => {
  for (const value of [undefined, "", "   ", "dev-placeholder-BITCOIN_ABC_RPC_URL"]) {
    assert.throws(() => parseBitcoinAbcRpcConfig(value), /configuration is missing/);
  }
});

test("rejects invalid protocols and missing credentials", () => {
  assert.throws(
    () => parseBitcoinAbcRpcConfig("ftp://rpc-user:rpc-pass@example.com:8332"),
    /configuration is invalid/
  );
  assert.throws(() => parseBitcoinAbcRpcConfig("http://example.com:8332"), /credentials are missing/);
});

test("supports legacy separate credentials without placing them in the request URL", () => {
  const config = parseBitcoinAbcRpcConfig("http://127.0.0.1:8332", "legacy-user", "legacy-pass");

  assert.equal(config.url, "http://127.0.0.1:8332/");
  assert.equal(config.user, "legacy-user");
  assert.equal(config.pass, "legacy-pass");
});
