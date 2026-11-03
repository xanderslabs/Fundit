// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sqliteDb } from '../admin/worker/testing/sqliteDb'
import type { Env } from './index'
import { handleModeration } from './moderation'

const SCHEMA = readFileSync(new URL('../moderation/migrations/0001_fundit_state.sql', import.meta.url), 'utf8')
const A = '0x' + 'aa'.repeat(20)
const B = '0x' + 'bb'.repeat(20)
const C = '0x' + 'cc'.repeat(20)
const D = '0x' + 'dd'.repeat(20)
const NOTE = 'private-owner-note-9f3'

function seeded() {
  const db = sqliteDb(SCHEMA)
  const rows: [string, string, string][] = [
    ['mainnet', A, 'review'],
    ['mainnet', B, 'removed'],
    ['mainnet', C, 'cleared'],
    ['testnet', D, 'review'],
  ]
  for (const [network, address, state] of rows) {
    db.prepare('INSERT INTO fundit_state (network, address, state, note, updated_at) VALUES (?, ?, ?, ?, ?)').bind(network, address, state, NOTE, 1).run()
  }
  return db
}

function env(over: Partial<Env> = {}): Env {
  return { MOD_DB: seeded(), NETWORK: 'mainnet', ...over } as Env
}
const get = (path: string, method = 'GET') => new Request(`https://fundit.fun${path}`, { method })

describe('GET /api/moderation', () => {
  it('returns only flagged Fundits for the Worker network', async () => {
    const res = await handleModeration(get('/api/moderation'), env({ NETWORK: 'mainnet' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ review: [A], removed: [B] })
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('reads the testnet rows on a testnet Worker', async () => {
    const res = await handleModeration(get('/api/moderation'), env({ NETWORK: 'testnet' }))
    expect(await res.json()).toEqual({ review: [D], removed: [] })
  })

  it('never returns the note', async () => {
    const res = await handleModeration(get('/api/moderation'), env())
    expect(await res.text()).not.toContain(NOTE)
  })

  it('answers empty lists when MOD_DB is missing', async () => {
    const res = await handleModeration(get('/api/moderation'), env({ MOD_DB: undefined }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ review: [], removed: [] })
  })

  it('refuses anything but GET with 405', async () => {
    const res = await handleModeration(get('/api/moderation', 'POST'), env())
    expect(res.status).toBe(405)
  })

  it('answers 503 when NETWORK is not mainnet or testnet', async () => {
    const res = await handleModeration(get('/api/moderation'), env({ NETWORK: 'devnet' }))
    expect(res.status).toBe(503)
  })
})
