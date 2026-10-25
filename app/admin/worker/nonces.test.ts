// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { consumeNonce, issueNonce, NONCE_TTL_MS, pruneNonces } from './nonces'
import { sqliteDb } from './testing/sqliteDb'

const SCHEMA = readFileSync(new URL('../migrations/0001_nonces.sql', import.meta.url), 'utf8')
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)

async function count(db: ReturnType<typeof sqliteDb>): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM nonces').first<{ n: number }>())?.n ?? -1
}

describe('nonces', () => {
  // A captured login (message and signature) must not sign anyone in a second time.
  it('a nonce can be consumed once', async () => {
    const db = sqliteDb(SCHEMA)
    const issued = await issueNonce(db, NOW)
    expect(issued.issuedAt).toBe(new Date(NOW).toISOString())
    expect(issued.expirationTime).toBe(new Date(NOW + NONCE_TTL_MS).toISOString())
    expect(issued.nonce).toMatch(/^[a-zA-Z0-9]{8,}$/)
    expect(await consumeNonce(db, issued.nonce, NOW + 1_000)).toBe(true)
    expect(await consumeNonce(db, issued.nonce, NOW + 2_000)).toBe(false)
  })

  it('an expired nonce is refused', async () => {
    const db = sqliteDb(SCHEMA)
    const { nonce } = await issueNonce(db, NOW)
    expect(await consumeNonce(db, nonce, NOW + NONCE_TTL_MS)).toBe(false)
  })

  // Only nonces this Worker issued count, so a message signed for a made-up nonce gets nowhere.
  it('an unknown nonce is refused', async () => {
    const db = sqliteDb(SCHEMA)
    await issueNonce(db, NOW)
    expect(await consumeNonce(db, 'neverissued123', NOW)).toBe(false)
  })

  it('prune removes only expired rows', async () => {
    const db = sqliteDb(SCHEMA)
    await issueNonce(db, NOW)
    const fresh = await issueNonce(db, NOW + 5 * 60_000)
    await pruneNonces(db, NOW + NONCE_TTL_MS + 1)
    expect(await count(db)).toBe(1)
    expect(await consumeNonce(db, fresh.nonce, NOW + NONCE_TTL_MS + 2)).toBe(true)
  })

  it('issues a different nonce each time', async () => {
    const db = sqliteDb(SCHEMA)
    const a = await issueNonce(db, NOW)
    const b = await issueNonce(db, NOW)
    expect(a.nonce).not.toBe(b.nonce)
    // Not a shifted copy of the last one (viem's generateSiweNonce returns overlapping slices of one buffer).
    expect(b.nonce.includes(a.nonce.slice(1, 40))).toBe(false)
  })
})
