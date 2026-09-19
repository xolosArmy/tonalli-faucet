# Tonalli Faucet Backend

TypeScript Express backend for Tonalli Faucet. Phase B1.1 adds Starter Pack Guardian RMZ:

> Primero te damos chispa para encender tu identidad. Despues decides cuanto quieres participar.

The starter pack gives a new wallet a small XEC gas balance plus an initial RMZ token amount for ecosystem belonging.

## Endpoints

### Health

```bash
curl http://127.0.0.1:3015/v1/faucet/health | jq
```

Returns faucet health and starter-pack configuration that is safe to expose.

### Welcome XEC starter pack

`POST /v1/faucet/starter-pack` is owned exclusively by the one-time Welcome Claim
primitive. Identity is the wallet address. IP is secondary anti-abuse only.

```bash
curl -X POST http://127.0.0.1:3015/v1/faucet/starter-pack   -H "Content-Type: application/json"   -d '{"address":"ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3"}' | jq
```

```bash
curl "http://127.0.0.1:3015/v1/faucet/starter-pack/config" | jq
curl "http://127.0.0.1:3015/v1/faucet/starter-pack/status?address=ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3" | jq
```

Success response:

```json
{
  "ok": true,
  "status": "completed",
  "address": "ecash:q...",
  "starterPack": {
    "xecSats": "100000",
    "xec": "1000"
  },
  "txid": "dryrun-xec-...",
  "dryRun": true
}
```

Quick Start Welcome XEC requires `TURNSTILE_ENABLED=false`. The config payload
includes `turnstileRequired` and `quickStartCompatible`. If Turnstile is
enabled, `POST /starter-pack` fails closed without sending XEC so the wallet UI
cannot offer a button the backend would reject. One-time address identity and
IP rate limits remain the anti-abuse controls for this path.

The same address never receives a second real transfer. Ambiguous broadcast
outcomes become `pending_review` and are not retried automatically. Invalid
addresses return HTTP 400. Rate limits return `status: "rate_limited"`.

### Stats

```bash
curl http://127.0.0.1:3015/v1/faucet/stats | jq
```

The endpoint reports the current operational authorities without dropping legacy observability:

```json
{
  "social": { "total": 0, "completed": 0, "pending": 0, "needsReview": 0, "failed": 0 },
  "legacyStarterPack": { "totalClaims": 0, "completedClaims": 0, "failedClaims": 0, "dryRunClaims": 0 },
  "welcome": { "total": 0, "completed": 0, "pending": 0, "needsReview": 0, "retryable": 0, "dryRun": 0 }
}
```

`welcome.completed` is real Welcome XEC broadcasts. `welcome.dryRun` is simulated-only claims. `legacyStarterPack` preserves historical starter-pack rows. The endpoint does not expose IP hashes, user agents, mnemonics, private keys, or raw database rows.

Existing routes under `/api/v1/status` and `/api/v1/faucet/claim` are preserved. The new routes are also available under `/api/v1/faucet` for compatibility.

## Environment

```dotenv
PORT=3015
CHRONIK_URL=https://chronik.xolosarmy.xyz
ALLOWED_ORIGIN=https://ecash.mx,https://cartera.xolosarmy.xyz,https://app.tonalli.cash,http://localhost:5173,http://127.0.0.1:5173
BITCOIN_ABC_RPC_URL=http://user:password@host:port

FAUCET_ENABLED=true
FAUCET_DRY_RUN=true
FAUCET_MNEMONIC=

STARTER_XEC_SATS=100000
STARTER_RMZ_ATOMS=1
RMZ_TOKEN_ID=c923bd0f09c630c5e9980cf518c8d34b6353802a3cb7c3f34fa7cc85c9305908

TURNSTILE_ENABLED=false
TURNSTILE_SECRET_KEY=

FAUCET_COOLDOWN_DAYS=30
FAUCET_DB_PATH=data/faucet.sqlite
```

Legacy variables such as `CORS_ORIGIN` and `SQLITE_PATH` are still accepted as fallbacks. `BITCOIN_ABC_RPC_URL` is backend-only, is validated at startup, and must include credentials in the documented URL format. Separate `BITCOIN_ABC_RPC_USER` and `BITCOIN_ABC_RPC_PASS` values remain accepted only for compatibility with older deployments.

## Dry Run Mode

`FAUCET_DRY_RUN=true` is the default and recommended deployment setting for Phase B1.1 validation. In dry-run mode the service:

- validates the `ecash:` address
- rejects `tokenaddr:` and invalid addresses
- applies address and IP cooldown rules
- writes a `starter_pack_claims` record
- returns simulated txids prefixed with `dryrun-xec-` and `dryrun-rmz-`
- does not broadcast transactions or require faucet wallet funds

Live XEC sending uses Bitcoin ABC `sendtoaddress`. Live RMZ token sending is intentionally scaffolded but not enabled because the backend does not yet have a safe token-send implementation. Keep `FAUCET_DRY_RUN=true` until that path is implemented and reviewed.

## Anti-Abuse Rules

Starter-pack claims are stored in the existing SQLite database at `FAUCET_DB_PATH`. The table `starter_pack_claims` records address, IP hash, user agent, timestamps, txids, status, and dry-run state.

Cooldown rules:

- one starter pack per address every `FAUCET_COOLDOWN_DAYS`
- one starter pack per IP hash every `FAUCET_COOLDOWN_DAYS`

The server stores only HMAC IP hashes, using `IP_HASH_SECRET`.

## Turnstile

Welcome Quick Start (`GET/POST /v1/faucet/starter-pack*`) requires `TURNSTILE_ENABLED=false`. This gate does not integrate a Turnstile widget into RMZWallet. Anti-abuse for Welcome XEC is one-time address identity plus IP/rate limits.

If `TURNSTILE_ENABLED=true`:

- process startup logs `Welcome Quick Start configuration rejected`
- `GET /starter-pack/config` returns `turnstileRequired: true` and `quickStartCompatible: false`
- `POST /starter-pack` fails closed with HTTP 503 and does not send XEC
- RMZWallet hides `[ Recibir XEC ]` so the UI cannot offer a button the backend would reject

Social `POST /claim` is a separate product and may still use Turnstile when enabled.

## CORS

`ALLOWED_ORIGIN` is a comma-separated list of trusted origins. Requests with no `Origin` header are allowed for curl and server-to-server calls.

## Development

```bash
npm run typecheck
npm run build
npm run dev
```

Manual checks:

```bash
curl http://127.0.0.1:3015/v1/faucet/health | jq

curl -X POST http://127.0.0.1:3015/v1/faucet/starter-pack   -H "Content-Type: application/json"   -d '{"address":"invalid"}' | jq

curl -X POST http://127.0.0.1:3015/v1/faucet/starter-pack   -H "Content-Type: application/json"   -d '{"address":"ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3"}' | jq
```

Repeat the valid request to confirm the cooldown block.

## Deployment Safety

Use a dedicated faucet wallet only. Never use a treasury wallet, master wallet, or any wallet that controls funds beyond the faucet budget. Never log `FAUCET_MNEMONIC`, RPC credentials, private keys, or seed material.
