import { db } from "./db.js";

export type WelcomeClaimStatus =
  | "pending"
  | "completed"
  | "failed_retryable"
  | "needs_review"
  | "dry_run_completed";

export type WelcomeClaimRow = {
  address: string;
  ipHash: string;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  xecTxid: string | null;
  status: WelcomeClaimStatus;
  dryRun: number;
  error: string | null;
};

export type WelcomeClaimReservation =
  | { kind: "reserved"; claim: WelcomeClaimRow }
  | { kind: "existing"; claim: WelcomeClaimRow };

db.exec(`
  CREATE TABLE IF NOT EXISTS welcome_claims (
    address TEXT PRIMARY KEY,
    ipHash TEXT NOT NULL,
    userAgent TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    xecTxid TEXT,
    status TEXT NOT NULL,
    dryRun INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_welcome_claims_ipHash_updatedAt
    ON welcome_claims (ipHash, updatedAt);
`);

function getWelcomeClaimUnsafe(address: string): WelcomeClaimRow | undefined {
  return db.prepare("SELECT * FROM welcome_claims WHERE address = ?").get(address) as
    | WelcomeClaimRow
    | undefined;
}

export function getWelcomeClaim(address: string): WelcomeClaimRow | undefined {
  return getWelcomeClaimUnsafe(address);
}

const reserveTransaction = db.transaction((params: {
  address: string;
  ipHash: string;
  userAgent?: string;
  now: string;
  dryRun: boolean;
}): WelcomeClaimReservation => {
  const retry = db.prepare(`
    UPDATE welcome_claims
    SET ipHash = ?, userAgent = ?, updatedAt = ?, xecTxid = NULL,
        status = 'pending', dryRun = ?, error = NULL
    WHERE address = ? AND status = 'failed_retryable'
  `).run(
    params.ipHash,
    params.userAgent ?? null,
    params.now,
    params.dryRun ? 1 : 0,
    params.address
  );

  if (retry.changes === 1) {
    return { kind: "reserved", claim: getWelcomeClaimUnsafe(params.address)! };
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO welcome_claims (
      address, ipHash, userAgent, createdAt, updatedAt, status, dryRun
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    params.address,
    params.ipHash,
    params.userAgent ?? null,
    params.now,
    params.now,
    params.dryRun ? 1 : 0
  );

  const claim = getWelcomeClaimUnsafe(params.address);
  if (!claim) {
    throw new Error("WELCOME_CLAIM_RESERVATION_MISSING");
  }

  return insert.changes === 1
    ? { kind: "reserved", claim }
    : { kind: "existing", claim };
});

export function reserveWelcomeClaim(params: {
  address: string;
  ipHash: string;
  userAgent?: string;
  now: string;
  dryRun: boolean;
}): WelcomeClaimReservation {
  return reserveTransaction(params);
}

export function completeWelcomeClaim(params: {
  address: string;
  txid: string;
  now: string;
  dryRun: boolean;
}): boolean {
  const status: WelcomeClaimStatus = params.dryRun ? "dry_run_completed" : "completed";
  const result = db.prepare(`
    UPDATE welcome_claims
    SET xecTxid = ?, updatedAt = ?, status = ?, error = NULL
    WHERE address = ? AND status = 'pending'
  `).run(params.txid, params.now, status, params.address);
  return result.changes === 1;
}

export function markWelcomeClaimFailedRetryable(params: {
  address: string;
  now: string;
  error: string;
}): boolean {
  const result = db.prepare(`
    UPDATE welcome_claims
    SET updatedAt = ?, status = 'failed_retryable', error = ?, xecTxid = NULL
    WHERE address = ? AND status = 'pending'
  `).run(params.now, params.error, params.address);
  return result.changes === 1;
}

export function markWelcomeClaimNeedsReview(params: {
  address: string;
  now: string;
  error: string;
  txid?: string | null;
}): boolean {
  const result = db.prepare(`
    UPDATE welcome_claims
    SET updatedAt = ?, status = 'needs_review', error = ?,
        xecTxid = COALESCE(?, xecTxid)
    WHERE address = ? AND status = 'pending'
  `).run(params.now, params.error, params.txid ?? null, params.address);
  return result.changes === 1;
}

export function getWelcomeClaimStats(): {
  total: number;
  completed: number;
  pending: number;
  needsReview: number;
  retryable: number;
  dryRun: number;
} {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END), 0) AS needsReview,
      COALESCE(SUM(CASE WHEN status = 'failed_retryable' THEN 1 ELSE 0 END), 0) AS retryable,
      COALESCE(SUM(CASE WHEN status = 'dry_run_completed' THEN 1 ELSE 0 END), 0) AS dryRun
    FROM welcome_claims
  `).get() as {
    total: number;
    completed: number;
    pending: number;
    needsReview: number;
    retryable: number;
    dryRun: number;
  };
}
