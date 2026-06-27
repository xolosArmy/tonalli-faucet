import { Router } from "express";
import { config } from "../config.js";
import { getStats } from "../db.js";

export const statusRouter = Router();

statusRouter.get("/", (_req, res) => {
  const stats = getStats();
  res.json({
    totalClaims: stats.totalClaims,
    uniqueAddresses: stats.uniqueAddresses,
    faucetEnabled: config.faucetEnabled,
    claimAmountXec: config.claimAmountXec,
    twitterGateEnabled: config.twitterGateEnabled,
    twitterTargetTweetUrl: config.twitterTargetTweetUrl || undefined,
    telegramGateEnabled: config.telegramGateEnabled,
    telegramTargetChatUrl: config.telegramTargetChatUrl || undefined,
    telegramBotUsername: config.telegramBotUsername || undefined
  });
});
