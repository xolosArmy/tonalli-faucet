import { config } from "../config.js";
import { AppError, errorMessage } from "../utils/errors.js";

export const FAUCET_MAINTENANCE_MESSAGE = "El faucet está temporalmente en mantenimiento. Intenta más tarde.";

type JsonRpcResponse = {
  result?: unknown;
  error?: { code: number; message: string } | null;
  id: string;
};

export type BitcoinAbcRpcErrorCategory =
  | "connection_refused"
  | "dns_failure"
  | "authentication_failed"
  | "wallet_not_loaded"
  | "insufficient_funds"
  | "invalid_request"
  | "rpc_rejected"
  | "timeout"
  | "connection_lost"
  | "invalid_json"
  | "missing_txid"
  | "http_error"
  | "unknown";

export class BitcoinAbcRpcError extends AppError {
  public readonly name = "BitcoinAbcRpcError";

  constructor(
    public readonly category: BitcoinAbcRpcErrorCategory,
    public readonly broadcastMayHaveOccurred: boolean,
    public readonly publicMessage: string,
    public readonly internalDetail: string
  ) {
    super(503, publicMessage, true, internalDetail);
  }
}

export function isBitcoinAbcRpcError(error: unknown): error is BitcoinAbcRpcError {
  return error instanceof BitcoinAbcRpcError;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeRpcDetail(value: string): string {
  let sanitized = value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:(?:10|127)\.(?:\d{1,3}\.){2}\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, "[redacted-ip]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "?");

  for (const secret of [config.bitcoinAbcRpcUser, config.bitcoinAbcRpcPass]) {
    if (secret.length >= 3) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(secret), "g"), "[redacted]");
    }
  }

  return sanitized.slice(0, 500);
}

function rpcFailure(
  category: BitcoinAbcRpcErrorCategory,
  broadcastMayHaveOccurred: boolean,
  detail: string
): BitcoinAbcRpcError {
  return new BitcoinAbcRpcError(
    category,
    broadcastMayHaveOccurred,
    FAUCET_MAINTENANCE_MESSAGE,
    sanitizeRpcDetail(detail)
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string") return code;
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  return errorCode(cause);
}

function isTimeoutError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "ETIMEDOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  return error instanceof Error && /timeout|timed out/i.test(error.message);
}

function classifyFetchFailure(error: unknown): BitcoinAbcRpcError {
  const code = errorCode(error);
  if (code === "ECONNREFUSED") {
    return rpcFailure("connection_refused", false, "Bitcoin ABC RPC connection refused before broadcast");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return rpcFailure("dns_failure", false, `Bitcoin ABC RPC DNS failure before broadcast: ${code}`);
  }
  if (isTimeoutError(error)) {
    return rpcFailure("timeout", true, "Bitcoin ABC RPC request timed out; broadcast status is unknown");
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return rpcFailure("connection_lost", true, `Bitcoin ABC RPC connection lost after request start: ${code}`);
  }
  return rpcFailure("unknown", true, `Bitcoin ABC RPC request failed with unknown broadcast status: ${errorMessage(error)}`);
}

function classifyRpcError(error: { code: number; message: string }): BitcoinAbcRpcError {
  const detail = `Bitcoin ABC RPC error ${error.code}: ${error.message}`;

  if (error.code === -18) {
    return rpcFailure("wallet_not_loaded", false, detail);
  }
  if (error.code === -6) {
    return rpcFailure("insufficient_funds", false, detail);
  }
  if (error.code === -3 || error.code === -5 || error.code === -8 || error.code === -32602 || error.code === -32601) {
    return rpcFailure("invalid_request", false, detail);
  }
  if (error.code === -32700 || error.code === -32600) {
    return rpcFailure("rpc_rejected", false, detail);
  }

  return rpcFailure("unknown", true, `${detail}; broadcast status is unknown`);
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
    throw classifyFetchFailure(error);
  }

  if (response.status === 401 || response.status === 403) {
    throw rpcFailure("authentication_failed", false, `Bitcoin ABC RPC authentication failed with HTTP ${response.status}`);
  }

  let payload: JsonRpcResponse;
  try {
    payload = (await response.json()) as JsonRpcResponse;
  } catch (error) {
    throw rpcFailure(
      response.ok ? "invalid_json" : "http_error",
      true,
      `Bitcoin ABC RPC returned invalid JSON with HTTP ${response.status}: ${errorMessage(error)}`
    );
  }

  if (!response.ok && !payload.error) {
    throw rpcFailure("http_error", true, `Bitcoin ABC RPC returned HTTP ${response.status} without JSON-RPC error`);
  }

  if (payload.error) {
    throw classifyRpcError(payload.error);
  }
  if (typeof payload.result !== "string" || payload.result.length === 0) {
    throw rpcFailure("missing_txid", true, "Bitcoin ABC RPC did not return a transaction id; broadcast status is unknown");
  }

  return payload.result;
}

export async function sendRmzToAddress(_address: string, _atoms: string): Promise<string> {
  throw new AppError(501, "Live RMZ token sending is not implemented safely yet; keep FAUCET_DRY_RUN=true.");
}
