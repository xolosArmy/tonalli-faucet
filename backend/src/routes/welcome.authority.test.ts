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
  const post = source.slice(source.indexOf('welcomeRouter.post("/starter-pack"'));
  assert.ok(post.indexOf("starterPackPayload()") < post.indexOf("reserveWelcomeClaim"));
  assert.match(source, /parseWelcomePayout/);
  assert.match(source, /starterPack\.rpcAmount/);
});

test("welcome_claims adopta filas legacy funded y distingue dry-run de completed real", () => {
  const claims = readFileSync(join(here, "../welcomeClaims.ts"), "utf8");
  const faucet = readFileSync(join(here, "faucet.ts"), "utf8");
  assert.match(claims, /adoptLegacyFundedStarterPackClaims/);
  assert.match(claims, /starter_pack_claims/);
  assert.match(claims, /status = 'dry_run_completed'/);
  assert.match(claims, /xecTxid NOT LIKE 'dryrun-%'/);
  assert.match(faucet, /legacyStarterPack/);
  assert.match(faucet, /welcome: getWelcomeClaimStats/);
  assert.match(faucet, /starterPackEnabled: config.faucetEnabled && quickStartCompatible && welcomePayoutValid/);
});

test("index monta welcomeRouter antes de faucetRouter", () => {
  const source = readFileSync(join(here, "../index.ts"), "utf8");
  const welcomeMount = source.indexOf('app.use("/v1/faucet", welcomeRouter)');
  const faucetMount = source.indexOf('app.use("/v1/faucet", faucetRouter)');
  assert.ok(welcomeMount >= 0 && faucetMount > welcomeMount);
});

test("README describe welcome_claims y no el starter pack XEC+RMZ como autoridad actual", () => {
  const readme = readFileSync(join(here, "../../README.md"), "utf8");
  const overview = readme.slice(0, readme.indexOf("## Endpoints"));
  assert.match(overview, /Welcome XEC/);
  assert.match(overview, /starter-pack` distributes XEC only/);
  assert.doesNotMatch(overview, /Phase B1\.1 adds Starter Pack Guardian RMZ/);
  assert.doesNotMatch(overview, /plus an initial RMZ token amount/);
  assert.match(readme, /welcome_claims/);
  assert.match(readme, /real Welcome XEC/);
  assert.doesNotMatch(readme, /writes a `starter_pack_claims` record/);
  assert.doesNotMatch(readme, /dryrun-rmz-/);
  assert.match(readme, /ADDRESS_COOLDOWN_HOURS=24/);
  assert.match(readme, /ADDRESS_COOLDOWN_HOURS.*social `POST \/claim`/);
  assert.doesNotMatch(readme, /FAUCET_COOLDOWN_DAYS/);
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
