export type BitcoinAbcRpcConfig = {
  url: string;
  user: string;
  pass: string;
};

const EXPECTED_FORMAT = "http://user:password@host:port";

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Bitcoin ABC RPC configuration is invalid. Expected ${EXPECTED_FORMAT}.`);
  }
}

export function parseBitcoinAbcRpcConfig(
  rawUrl: string | undefined,
  legacyUser?: string,
  legacyPass?: string
): BitcoinAbcRpcConfig {
  const value = rawUrl?.trim() ?? "";

  if (!value || value.toLowerCase().startsWith("dev-placeholder")) {
    throw new Error(`Bitcoin ABC RPC configuration is missing. Expected ${EXPECTED_FORMAT}.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Bitcoin ABC RPC configuration is invalid. Expected ${EXPECTED_FORMAT}.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`Bitcoin ABC RPC configuration is invalid. Expected ${EXPECTED_FORMAT}.`);
  }

  const user = parsed.username ? decodeCredential(parsed.username) : legacyUser?.trim() ?? "";
  const pass = parsed.password ? decodeCredential(parsed.password) : legacyPass?.trim() ?? "";

  if (!user || !pass) {
    throw new Error(`Bitcoin ABC RPC credentials are missing. Expected ${EXPECTED_FORMAT}.`);
  }

  parsed.username = "";
  parsed.password = "";

  return { url: parsed.toString(), user, pass };
}
