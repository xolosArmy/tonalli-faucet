import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

type RetweetCacheEntry = { value: boolean; userId: string; expiresAt: number };

const retweetCache = new Map<string, RetweetCacheEntry>();

export function cleanTwitterHandle(raw: unknown): string {
  const handle = typeof raw === "string" ? raw.trim().replace(/^@/, "") : "";
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new AppError(400, "Usuario de X inválido.");
  }
  return handle;
}

async function fetchXJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.twitterBearerToken}` }
  });

  if (response.status === 429) {
    throw new AppError(429, "X esta limitando verificaciones en este momento. Intenta de nuevo mas tarde.");
  }
  if (!response.ok) {
    throw new AppError(502, "Error comunicándose con los servidores de X.");
  }

  return (await response.json()) as T;
}

type XUserResponse = {
  data?: { id: string; username: string };
};

type XRetweetedByResponse = {
  data?: Array<{ id: string; username?: string }>;
  meta?: { next_token?: string };
};

export async function verifyRetweetAndGetUserId(
  username: string,
  targetTweetId: string
): Promise<{ hasRetweeted: boolean; userId: string }> {
  const cacheKey = `${targetTweetId}:${username.toLowerCase()}`;
  const cached = retweetCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { hasRetweeted: cached.value, userId: cached.userId };
  }

  const userUrl = new URL(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`);
  const userData = await fetchXJson<XUserResponse>(userUrl);

  if (!userData.data) {
    throw new AppError(400, "El usuario de X no existe.");
  }

  const userId = userData.data.id;
  let hasRetweeted = false;
  let nextToken: string | undefined;

  for (let page = 0; page < config.twitterRetweetMaxPages; page += 1) {
    const retweetsUrl = new URL(`https://api.x.com/2/tweets/${encodeURIComponent(targetTweetId)}/retweeted_by`);
    retweetsUrl.searchParams.set("max_results", "100");
    if (nextToken) {
      retweetsUrl.searchParams.set("pagination_token", nextToken);
    }

    const retweetData = await fetchXJson<XRetweetedByResponse>(retweetsUrl);
    if (retweetData.data?.some((user) => user.id === userId)) {
      hasRetweeted = true;
      break;
    }

    nextToken = retweetData.meta?.next_token;
    if (!nextToken) {
      break;
    }
  }

  retweetCache.set(cacheKey, {
    value: hasRetweeted,
    userId,
    expiresAt: now + config.twitterCacheTtlSeconds * 1000
  });

  return { hasRetweeted, userId };
}
