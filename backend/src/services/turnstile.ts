import { config } from "../config.js";
import { AppError, errorMessage } from "../utils/errors.js";

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

export async function verifyTurnstileToken(token: string | undefined, remoteIp?: string): Promise<void> {
  if (!config.turnstileEnabled) {
    return;
  }
  if (!token || token.trim() === "") {
    throw new AppError(400, "Turnstile token is required.");
  }
  if (!config.turnstileSecretKey) {
    throw new AppError(503, "Turnstile is enabled but not configured.");
  }

  const body = new URLSearchParams({
    secret: config.turnstileSecretKey,
    response: token
  });
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
  } catch (error) {
    throw new AppError(502, `Turnstile verification failed: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw new AppError(502, `Turnstile verification returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as TurnstileResponse;
  if (!payload.success) {
    throw new AppError(403, "Turnstile verification failed.");
  }
}
