import { config } from "../config.js";
import { AppError, errorMessage } from "../utils/errors.js";

export const FAUCET_MAINTENANCE_MESSAGE = "El faucet está temporalmente en mantenimiento. Intenta más tarde.";

type JsonRpcResponse = {
  result?: unknown;
  error?: { code: number; message: string } | null;
  id: string;
};

function rpcFailure(detail: string): AppError {
  return new AppError(503, FAUCET_MAINTENANCE_MESSAGE, true, new Error(detail));
}

export async function sendXecToAddress(address: string, amountXec: string): Promise<string> {
  const amount = Number(amountXec);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(500, "Monto de faucet invalido");
  }

  const auth = Buffer.from(`${config.bitcoinAbcRpcUser}:${config.bitcoinAbcRpcPass}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(config.bitcoinAbcRpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "tonalli-faucet-send",
        method: "sendtoaddress",
        params: [address, amount]
      })
    });
  } catch (error) {
    throw rpcFailure(`Bitcoin ABC RPC connection failed: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw rpcFailure(`Bitcoin ABC RPC returned HTTP ${response.status}`);
  }

  let payload: JsonRpcResponse;
  try {
    payload = (await response.json()) as JsonRpcResponse;
  } catch (error) {
    throw rpcFailure(`Bitcoin ABC RPC returned invalid JSON: ${errorMessage(error)}`);
  }

  if (payload.error) {
    throw rpcFailure(`Bitcoin ABC RPC error ${payload.error.code}: ${payload.error.message}`);
  }
  if (typeof payload.result !== "string" || payload.result.length === 0) {
    throw rpcFailure("Bitcoin ABC RPC did not return a transaction id");
  }

  return payload.result;
}

export async function sendRmzToAddress(_address: string, _atoms: string): Promise<string> {
  throw new AppError(501, "Live RMZ token sending is not implemented safely yet; keep FAUCET_DRY_RUN=true.");
}
