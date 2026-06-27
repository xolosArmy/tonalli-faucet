import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

export type TelegramMembershipResult = {
  isMember: boolean;
  status?: string;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
};

type TelegramChatMember = {
  status?: string;
  is_member?: boolean;
};

export function telegramApiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

export function buildTelegramStartUrl(nonce: string): string {
  return `https://t.me/${config.telegramBotUsername}?start=${encodeURIComponent(nonce)}`;
}

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  const response = await fetch(telegramApiUrl("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  if (!response.ok) {
    throw new AppError(502, "No se pudo enviar el mensaje de Telegram.");
  }

  const data = (await response.json()) as TelegramApiResponse<unknown>;
  if (!data.ok) {
    throw new AppError(502, "No se pudo enviar el mensaje de Telegram.");
  }
}

export async function verifyTelegramMembership(
  userId: string,
  targetChatId: string
): Promise<TelegramMembershipResult> {
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
    throw new AppError(502, "No se pudo validar membresía de Telegram.");
  }

  const response = await fetch(telegramApiUrl("getChatMember"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: targetChatId, user_id: numericUserId })
  });

  if (!response.ok) {
    throw new AppError(502, "No se pudo validar membresía de Telegram.");
  }

  const data = (await response.json()) as TelegramApiResponse<TelegramChatMember>;
  if (!data.ok || !data.result) {
    throw new AppError(502, "No se pudo validar membresía de Telegram.");
  }

  const status = data.result.status;
  if (status === "creator" || status === "administrator" || status === "member") {
    return { isMember: true, status };
  }
  if (status === "restricted") {
    return { isMember: data.result.is_member === true, status };
  }
  return { isMember: false, status };
}

export function telegramDisplayHandle(user: {
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  if (user.username?.trim()) {
    return user.username.trim().replace(/^@/, "");
  }
  const name = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return name || "telegram-user";
}
