import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "./utils/errors.js";
import { MAX_WELCOME_RPC_XEC, parseWelcomePayout, rpcJsonTokenToSats } from "./welcomePayout.js";

test("JSON numeric tokens reconstruct exact satoshis using BigInt", () => {
  for (const [token, sats] of [
    ["1000", 100000n],
    ["1.1", 110n],
    ["1.01", 101n],
    ["0.01", 1n]
  ] as const) {
    assert.equal(rpcJsonTokenToSats(token), sats);
  }
});

test("JSON numeric tokens incompatible with two-decimal XEC are rejected", () => {
  for (const token of ["1e3", "1.234", "0.001", "-1", "01", "1.", ".01", " 1", "\"1.01\""]) {
    assert.throws(() => rpcJsonTokenToSats(token), AppError);
  }
});

test("small payouts survive the actual JSON number token", () => {
  for (const [rawSats, xec, rpcToken] of [
    ["1", "0.01", "0.01"],
    ["10", "0.1", "0.1"],
    ["101", "1.01", "1.01"],
    ["100000", "1000", "1000"]
  ]) {
    const payout = parseWelcomePayout(rawSats);
    assert.equal(payout.xec, xec);
    assert.equal(JSON.stringify(payout.rpcAmount), rpcToken);
    assert.equal(rpcJsonTokenToSats(rpcToken), BigInt(rawSats));
  }
});

test("rejects Codex precision-loss example but accepts the adjacent exact JSON token", () => {
  const lossySats = "900719925474099101";
  const canonicalXec = "9007199254740991.01";
  assert.equal(Number(canonicalXec), 9007199254740991);
  assert.equal(JSON.stringify(Number(canonicalXec)), "9007199254740991");
  assert.equal(rpcJsonTokenToSats(JSON.stringify(Number(canonicalXec))), 900719925474099100n);
  assert.throws(() => parseWelcomePayout(lossySats), AppError);

  const exact = parseWelcomePayout("900719925474099100");
  assert.equal(exact.xec, "9007199254740991");
  assert.equal(JSON.stringify(exact.rpcAmount), "9007199254740991");
  assert.equal(rpcJsonTokenToSats(JSON.stringify(exact.rpcAmount)), BigInt(exact.xecSats));
});

test("100000 sats es 1000 XEC finito y reutilizable", () => {
  const payout = parseWelcomePayout("100000");
  assert.equal(payout.xecSats, "100000");
  assert.equal(payout.xec, "1000");
  assert.equal(payout.rpcAmount, 1000);
  assert.equal(Number.isFinite(payout.rpcAmount), true);
});

test("rechaza 0, no-entero y enteros que desbordan Number", () => {
  assert.throws(() => parseWelcomePayout("0"), AppError);
  assert.throws(() => parseWelcomePayout("-1"), AppError);
  assert.throws(() => parseWelcomePayout("1.5"), AppError);
  assert.throws(() => parseWelcomePayout(`1${"0".repeat(399)}`), AppError);
  assert.throws(() => parseWelcomePayout("9".repeat(400)), AppError);
  assert.throws(
    () => parseWelcomePayout(((BigInt(MAX_WELCOME_RPC_XEC) + 1n) * 100n).toString()),
    AppError
  );
});
