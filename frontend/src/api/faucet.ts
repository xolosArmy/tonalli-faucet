const API_BASE_URL = import.meta.env.VITE_FAUCET_API_URL ?? "http://localhost:3001";

export type FaucetStatus = {
  totalClaims: number;
  uniqueAddresses: number;
  faucetEnabled: boolean;
  claimAmountXec: string;
};

export type ClaimResponse = {
  status: "ok";
  txid: string;
  claimCount: number;
  rmzGateRequired: boolean;
  rmzGatePassed: boolean;
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function getFaucetStatus(): Promise<FaucetStatus> {
  const response = await fetch(`${API_BASE_URL}/api/v1/status`);
  return parseJson<FaucetStatus>(response);
}

export async function claimFaucet(address: string, eventCode: string): Promise<ClaimResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/faucet/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, eventCode })
  });
  return parseJson<ClaimResponse>(response);
}
