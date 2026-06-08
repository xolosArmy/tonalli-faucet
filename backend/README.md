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

### Starter pack

```bash
curl -X POST http://127.0.0.1:3015/v1/faucet/starter-pack   -H "Content-Type: application/json"   -d '{"address":"ecash:qzdq0q65fwnt94rlcph5kllj0xcry6e0v58zrgp7a3"}' | jq
```

Success response:

```json
{
  "ok": true,
  "address": "ecash:q...",
  "starterPack": {
    "xecSats": "100000",
    "xec": "1000",
    "rmzAtoms": "1"
  },
  "txids": {
    "xec": "dryrun-xec-...",
    "rmz": "dryrun-rmz-..."
  },
  "dryRun": true,
  "nextSteps": [
    "Open Tonalli Wallet",
    "Register your .xec alias",
    "Verify your identity at https://ecash.mx/identidad"
  ]
}
```

Invalid addresses return HTTP 400 with `ok: false`. Repeated address or IP claims within the cooldown window return HTTP 429.

### Stats

```bash
curl http://127.0.0.1:3015/v1/faucet/stats | jq
```

Only aggregate counts are returned: `totalClaims`, `completedClaims`, `failedClaims`, and `dryRunClaims`. The endpoint does not expose IP hashes, user agents, mnemonics, private keys, or raw database rows.

Existing routes under `/api/v1/status` and `/api/v1/faucet/claim` are preserved. The new routes are also available under `/api/v1/faucet` for compatibility.

## Environment

```dotenv
PORT=3015
CHRONIK_URL=https://chronik.xolosarmy.xyz
ALLOWED_ORIGIN=https://ecash.mx,https://cartera.xolosarmy.xyz,https://app.tonalli.cash,http://localhost:5173,http://127.0.0.1:5173

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

Legacy variables such as `CORS_ORIGIN` and `SQLITE_PATH` are still accepted as fallbacks. Existing Bitcoin ABC RPC variables are still used by the legacy XEC faucet and by live XEC starter-pack sending.

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

When `TURNSTILE_ENABLED=false`, Turnstile is skipped.

When `TURNSTILE_ENABLED=true`, requests to `/v1/faucet/starter-pack` must include `turnstileToken`. The server verifies it with Cloudflare Turnstile `siteverify`, includes `remoteip` when available, and fails closed when verification fails or Turnstile is misconfigured.

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
