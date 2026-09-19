import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "./utils/errors.js";
import { MAX_WELCOME_RPC_XEC, parseWelcomePayout } from "./welcomePayout.js";

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
