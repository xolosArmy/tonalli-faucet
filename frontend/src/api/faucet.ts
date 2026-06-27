const API_BASE_URL = import.meta.env.VITE_FAUCET_API_URL ?? "http://localhost:3001";
export const FAUCET_MAINTENANCE_MESSAGE = "El faucet está temporalmente en mantenimiento. Intenta más tarde.";

export type FaucetStatus = {
  totalClaims: number;
  uniqueAddresses: number;
  faucetEnabled: boolean;
  claimAmountXec: string;
  twitterGateEnabled: boolean;
  twitterTargetTweetUrl?: string;
  telegramGateEnabled: boolean;
  telegramTargetChatUrl?: string;
  telegramBotUsername?: string;
};

export type ClaimResponse = {
  status: "ok";
  txid: string;
  claimCount: number;
  rmzGateRequired: boolean;
  rmzGatePassed: boolean;
  socialProvider?: "x" | "telegram";
};

export type TelegramStartResponse = {
  ok: true;
  provider: "telegram";
  nonce: string;
  botUrl: string;
  targetChatUrl?: string;
  expiresAt: string;
};

export type TelegramSessionStatus = {
  ok: true;
  provider: "telegram";
  verified: boolean;
  expired: boolean;
  handle?: string;
  targetChatUrl?: string;
};

export type ClaimParams = {
  address: string;
  eventCode: string;
  provider?: "x" | "telegram";
  twitterHandle?: string;
  telegramNonce?: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      response.status >= 500
        ? FAUCET_MAINTENANCE_MESSAGE
        : typeof data.error === "string"
          ? data.error
          : "No se pudo completar la solicitud.";
    throw new Error(message);
  }
  return data as T;
}

export async function getFaucetStatus(): Promise<FaucetStatus> {
  const response = await fetch(`${API_BASE_URL}/api/v1/status`);
  return parseJson<FaucetStatus>(response);
}

export async function createTelegramSession(
  address: string,
  eventCode: string
): Promise<TelegramStartResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/social/telegram/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, eventCode })
  });
  return parseJson<TelegramStartResponse>(response);
}

export async function getTelegramSession(nonce: string): Promise<TelegramSessionStatus> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/social/telegram/session/${encodeURIComponent(nonce)}`
  );
  return parseJson<TelegramSessionStatus>(response);
}

export async function claimFaucet(params: ClaimParams): Promise<ClaimResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/faucet/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params)
    });
  } catch {
    throw new Error(FAUCET_MAINTENANCE_MESSAGE);
  }

  return parseJson<ClaimResponse>(response);
}
