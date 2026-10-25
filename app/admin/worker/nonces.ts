// Sign-in nonces, kept in D1 so any isolate can check one. A nonce works once and for NONCE_TTL_MS.
import type { Db } from './db'

export const NONCE_TTL_MS = 600_000

// 32 random bytes as hex: 64 characters, all valid in an EIP-4361 nonce. Not viem's generateSiweNonce, which
// uses Math.random and returns overlapping slices of one buffer, so the next nonce is close to guessable.
function newNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function issueNonce(db: Db, nowMs: number): Promise<{ nonce: string; issuedAt: string; expirationTime: string }> {
  const nonce = newNonce()
  const expiresAt = nowMs + NONCE_TTL_MS
  await db.prepare('INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)').bind(nonce, expiresAt).run()
  return { nonce, issuedAt: new Date(nowMs).toISOString(), expirationTime: new Date(expiresAt).toISOString() }
}

// One statement deletes and reports, so two logins racing with the same nonce cannot both get true.
export async function consumeNonce(db: Db, nonce: string, nowMs: number): Promise<boolean> {
  const row = await db.prepare('DELETE FROM nonces WHERE nonce = ? AND expires_at > ? RETURNING nonce').bind(nonce, nowMs).first<{ nonce: string }>()
  return row !== null
}

export async function pruneNonces(db: Db, nowMs: number): Promise<void> {
  await db.prepare('DELETE FROM nonces WHERE expires_at <= ?').bind(nowMs).run()
}
