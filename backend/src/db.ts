import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "./config.js";

const dbPath = path.resolve(config.sqlitePath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    address TEXT PRIMARY KEY,
    claim_count INTEGER NOT NULL DEFAULT 0,
    first_claim_at TEXT,
    last_claim_at TEXT,
    last_txid TEXT,
    last_ip_hash TEXT,
    rmz_gate_passed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS claim_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    txid TEXT,
    ip_hash TEXT,
    user_agent TEXT,
    amount_xec TEXT,
    event_code TEXT,
    rmz_gate_required INTEGER,
    rmz_gate_passed INTEGER,
    created_at TEXT,
    status TEXT,
    error TEXT
  );
`);

export type ClaimRow = {
  address: string;
  claim_count: number;
  first_claim_at: string | null;
  last_claim_at: string | null;
  last_txid: string | null;
  last_ip_hash: string | null;
  rmz_gate_passed: number;
};

export function getClaim(address: string): ClaimRow | undefined {
  return db.prepare("SELECT * FROM claims WHERE address = ?").get(address) as ClaimRow | undefined;
}

export function getStats(): { totalClaims: number; uniqueAddresses: number } {
  const claimAgg = db.prepare("SELECT COALESCE(SUM(claim_count), 0) AS totalClaims, COUNT(*) AS uniqueAddresses FROM claims").get() as {
    totalClaims: number;
    uniqueAddresses: number;
  };
  return claimAgg;
}

export function upsertClaim(params: {
  address: string;
  txid: string;
  ipHash: string;
  rmzGatePassed: boolean;
  now: string;
}): number {
  const existing = getClaim(params.address);
  if (!existing) {
    db.prepare(`
      INSERT INTO claims (address, claim_count, first_claim_at, last_claim_at, last_txid, last_ip_hash, rmz_gate_passed)
      VALUES (?, 1, ?, ?, ?, ?, ?)
    `).run(params.address, params.now, params.now, params.txid, params.ipHash, params.rmzGatePassed ? 1 : 0);
    return 1;
  }

  const nextCount = existing.claim_count + 1;
  db.prepare(`
    UPDATE claims
    SET claim_count = ?, last_claim_at = ?, last_txid = ?, last_ip_hash = ?, rmz_gate_passed = ?
    WHERE address = ?
  `).run(nextCount, params.now, params.txid, params.ipHash, params.rmzGatePassed ? 1 : existing.rmz_gate_passed, params.address);
  return nextCount;
}

export function insertClaimEvent(params: {
  address: string;
  txid?: string | null;
  ipHash: string;
  userAgent?: string;
  amountXec: string;
  eventCode?: string | null;
  rmzGateRequired: boolean;
  rmzGatePassed: boolean;
  createdAt: string;
  status: "ok" | "error";
  error?: string | null;
}): void {
  db.prepare(`
    INSERT INTO claim_events (
      address, txid, ip_hash, user_agent, amount_xec, event_code, rmz_gate_required,
      rmz_gate_passed, created_at, status, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.address,
    params.txid ?? null,
    params.ipHash,
    params.userAgent ?? null,
    params.amountXec,
    params.eventCode ?? null,
    params.rmzGateRequired ? 1 : 0,
    params.rmzGatePassed ? 1 : 0,
    params.createdAt,
    params.status,
    params.error ?? null
  );
}
