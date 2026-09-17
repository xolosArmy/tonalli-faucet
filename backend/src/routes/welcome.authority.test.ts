import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

test("faucet.ts no registra un segundo POST /starter-pack", () => {
  const source = readFileSync(join(here, "faucet.ts"), "utf8");
  assert.equal(source.includes('post("/starter-pack"'), false);
  assert.match(source, /owned exclusively by welcomeRouter/);
});

test("welcome.ts es la autoridad de POST /starter-pack", () => {
  const source = readFileSync(join(here, "welcome.ts"), "utf8");
  assert.match(source, /welcomeRouter\.post\("\/starter-pack"/);
  assert.match(source, /reserveWelcomeClaim/);
  assert.match(source, /broadcastMayHaveOccurred/);
});

test("index monta welcomeRouter antes de faucetRouter", () => {
  const source = readFileSync(join(here, "../index.ts"), "utf8");
  const welcomeMount = source.indexOf('app.use("/v1/faucet", welcomeRouter)');
  const faucetMount = source.indexOf('app.use("/v1/faucet", faucetRouter)');
  assert.ok(welcomeMount >= 0 && faucetMount > welcomeMount);
});

test("welcome claim conserva dry-run, disable, rate-limit y turnstile fail-closed", () => {
  const welcome = readFileSync(join(here, "welcome.ts"), "utf8");
  const index = readFileSync(join(here, "../index.ts"), "utf8");
  const turnstile = readFileSync(join(here, "../services/turnstile.ts"), "utf8");
  assert.match(welcome, /if \(!config\.faucetEnabled\)/);
  assert.match(welcome, /config\.faucetDryRun/);
  assert.match(welcome, /welcomeIpLimiter/);
  assert.match(welcome, /status: "rate_limited"/);
  assert.match(welcome, /isWelcomeQuickStartCompatible/);
  assert.match(welcome, /WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE/);
  assert.match(index, /isWelcomeQuickStartCompatible/);
  assert.match(index, /Welcome Quick Start configuration rejected/);
  assert.match(index, /crossOriginResourcePolicy/);
  assert.match(index, /corsOptions/);
  assert.match(turnstile, /Turnstile is enabled but not configured/);
});
