# Faucet Tonalli

Faucet full-stack para entregar una cantidad pequeña de XEC a usuarios de Tonalli Wallet durante activaciones presenciales y onboarding masivo.

La regla principal es:

- El primer claim por direccion eCash es libre.
- A partir del segundo claim, el backend verifica que la direccion tenga al menos 1 RMZ.
- El backend valida direccion, codigo de evento, historial, rate limits, gate RMZ y envio RPC. No confia solo en el frontend.

## Flujo del usuario

1. El usuario abre el frontend.
2. Conecta Tonalli Wallet con WalletConnect v2.
3. El frontend obtiene una direccion `ecash:...`.
4. El usuario ingresa el codigo de evento si aplica.
5. El frontend envia `address` y `eventCode` al backend.
6. El backend valida y envia XEC desde una wallet de faucet separada.
7. El usuario ve el `txid`.

## Instalacion

```bash
npm install
cp .env.example backend/.env
cp .env.example frontend/.env
```

La configuracion base usa `RMZ_TOKEN_ID=c923bd0f09c630c5e9980cf518c8d34b6353802a3cb7c3f34fa7cc85c9305908` y `CHRONIK_URL=https://chronik.xolosarmy.xyz`. Edita `backend/.env` con credenciales RPC, `IP_HASH_SECRET` y la configuracion de evento. Edita `frontend/.env` con `VITE_API_BASE_URL` y `VITE_WALLETCONNECT_PROJECT_ID`.

## Correr

```bash
npm run dev
```

Backend: `http://localhost:3001`

Frontend: `http://localhost:5173`

## Probar

1. Primer claim libre: usa una direccion eCash valida que no exista en SQLite y llama `POST /api/v1/faucet/claim`.
2. Segundo claim sin RMZ: repite con la misma direccion sin balance RMZ. Debe responder 403 con el mensaje de requisito RMZ.
3. Segundo claim con al menos 1 RMZ: repite con una direccion que tenga balance RMZ segun Chronik. Debe pasar el gate y registrar `rmz_gate_passed`.

## Endpoints

`GET /api/v1/status`

Devuelve `totalClaims`, `uniqueAddresses`, `faucetEnabled` y `claimAmountXec`.

`POST /api/v1/faucet/claim`

```json
{
  "address": "ecash:...",
  "eventCode": "TONALLI-CU"
}
```

## Chronik y RMZ

La verificacion de segundo claim consulta Xolos Chronik en `https://chronik.xolosarmy.xyz` y requiere al menos 1 Xolos RMZ con token ID `c923bd0f09c630c5e9980cf518c8d34b6353802a3cb7c3f34fa7cc85c9305908`. `https://chronik.e.cash` puede usarse solo como fallback operativo si se configura explicitamente y soporta los mismos datos de token.

## Seguridad

- Usa una wallet separada para la faucet con saldo limitado. No uses tesoreria principal.
- Mantén `EVENT_CODE_REQUIRED=true` en activaciones presenciales.
- No guardes IP cruda; el backend guarda HMAC-SHA256 con `IP_HASH_SECRET`.
- No expongas credenciales RPC ni secretos en frontend.
- Si `FAUCET_ENABLED=false`, el backend rechaza claims.
- Si Chronik no responde, no se permite un segundo claim.

## Notas de integracion

WalletConnect y Chronik pueden requerir ajustes finos segun los namespaces y metodos exactos implementados por Tonalli Wallet. El codigo incluye comentarios en esos puntos para adaptar `ecash_getAddresses`, cadenas WalletConnect y lectura de balances token desde Chronik.
