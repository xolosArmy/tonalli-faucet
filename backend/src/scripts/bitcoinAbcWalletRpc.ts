import { config } from "../config.js";
import { errorMessage } from "../utils/errors.js";

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string } | null;
  id: string;
};

export type UnspentOutput = {
  txid: string;
  vout: number;
  address?: string;
  amount: number;
  confirmations: number;
  spendable?: boolean;
};

function rpcAuthHeader(): string {
  return `Basic ${Buffer.from(`${config.bitcoinAbcRpcUser}:${config.bitcoinAbcRpcPass}`).toString("base64")}`;
}

export async function callBitcoinAbcRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  let response: Response;
  try {
    response = await fetch(config.bitcoinAbcRpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: rpcAuthHeader()
      },
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: `tonalli-faucet-${method}`,
        method,
        params
      })
    });
  } catch (error) {
    throw new Error(`No se pudo conectar con Bitcoin ABC RPC: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Bitcoin ABC RPC respondio HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(`Bitcoin ABC RPC error ${payload.error.code}: ${payload.error.message}`);
  }
  return payload.result as T;
}
