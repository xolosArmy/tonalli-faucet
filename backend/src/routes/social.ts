import crypto from "node:crypto";
import { Router } from "express";
import { isValidEcashAddress } from "@xolosarmy/tonalli-core";
import { config } from "../config.js";
import {
  createSocialAuthSession,
  getSocialAuthSession,
  verifySocialAuthSession
} from "../db.js";
import {
  buildTelegramStartUrl,
  sendTelegramMessage,
  telegramDisplayHandle
} from "../services/telegram.js";
import { AppError } from "../utils/errors.js";

export const socialRouter = Router();

function cleanEventCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : null;
}

function assertTelegramGateEnabled(): void {
  if (!config.telegramGateEnabled) {
    throw new AppError(404, "Telegram Gate no está habilitado.");
  }
}

function isExpired(expiresAt: string): boolean {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= Date.now();
}

function isValidWebhookSecret(value: string | undefined): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(config.telegramWebhookSecret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function safelySendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  try {
    await sendTelegramMessage(chatId, text);
  } catch (error) {
    console.error("[telegram] sendMessage failed.");
  }
}

socialRouter.post("/telegram/start", (req, res, next) => {
  try {
    assertTelegramGateEnabled();
    const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
    if (!address) {
      throw new AppError(400, "La dirección eCash es requerida.");
    }
    if (!isValidEcashAddress(address)) {
      throw new AppError(400, "La dirección eCash no es válida.");
    }

    const eventCode = cleanEventCode(req.body?.eventCode);
    if (config.eventCodeRequired && eventCode !== config.eventCode) {
      throw new AppError(403, "Código de evento inválido.");
    }

    const nonce = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + config.telegramSessionTtlMinutes * 60 * 1000
    ).toISOString();

    createSocialAuthSession({
      nonce,
      provider: "telegram",
      address,
      eventCode,
      targetId: config.telegramTargetChatId,
      createdAt: createdAt.toISOString(),
      expiresAt
    });

    res.json({
      ok: true,
      provider: "telegram",
      nonce,
      botUrl: buildTelegramStartUrl(nonce),
      targetChatUrl: config.telegramTargetChatUrl || undefined,
      expiresAt
    });
  } catch (error) {
    next(error);
  }
});

socialRouter.get("/telegram/session/:nonce", (req, res, next) => {
  try {
    assertTelegramGateEnabled();
    const nonce = req.params.nonce?.trim();
    if (!nonce) {
      throw new AppError(400, "Nonce de Telegram requerido.");
    }
    const session = getSocialAuthSession(nonce);
    if (!session || session.provider !== "telegram") {
      throw new AppError(404, "Verificación de Telegram no encontrada.");
    }

    const expired = isExpired(session.expires_at);
    res.json({
      ok: true,
      provider: "telegram",
      verified: !expired && Boolean(session.verified_at && session.provider_user_id),
      expired,
      handle: session.handle || undefined,
      targetChatUrl: config.telegramTargetChatUrl || undefined
    });
  } catch (error) {
    next(error);
  }
});

socialRouter.post("/telegram/webhook", async (req, res, next) => {
  try {
    assertTelegramGateEnabled();
    if (!isValidWebhookSecret(req.get("x-telegram-bot-api-secret-token"))) {
      throw new AppError(401, "Webhook de Telegram no autorizado.");
    }

    const message = req.body?.message;
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    const chatId = message?.chat?.id;
    const from = message?.from;
    const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([^\s]+))?/i);

    if (!match || !from || (typeof from.id !== "number" && typeof from.id !== "string")) {
      res.json({ ok: true });
      return;
    }

    const nonce = match[1];
    if (!nonce) {
      if (chatId !== undefined) {
        await safelySendTelegramMessage(chatId, "Vuelve a Tonalli Faucet y genera un enlace de verificación.");
      }
      res.json({ ok: true });
      return;
    }

    const session = getSocialAuthSession(nonce);
    if (!session || session.provider !== "telegram" || isExpired(session.expires_at)) {
      if (chatId !== undefined) {
        await safelySendTelegramMessage(
          chatId,
          "Este enlace expiró. Vuelve a Tonalli Faucet y genera una nueva verificación."
        );
      }
      res.json({ ok: true });
      return;
    }

    verifySocialAuthSession({
      nonce,
      providerUserId: String(from.id),
      handle: telegramDisplayHandle(from),
      verifiedAt: new Date().toISOString()
    });

    if (chatId !== undefined) {
      const channelLink = config.telegramTargetChatUrl
        ? `\n${config.telegramTargetChatUrl}`
        : "";
      await safelySendTelegramMessage(
        chatId,
        `Verificación recibida. Ahora únete al canal oficial y vuelve a Tonalli Faucet para reclamar tus XEC.${channelLink}`
      );
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
