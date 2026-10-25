// @vitest-environment node
import { readFileSync } from 'node:fs'
import { encodeAbiParameters, encodeEventTopics, numberToHex, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { factoryAbi } from '../../src/abi/factory'
import { adminChain } from './chain'
import { runCron } from './cron'
import { sqliteDb } from './testing/sqliteDb'
import type { Env } from './index'

const SCHEMA = ['0001_nonces.sql', '0002_alerts.sql'].map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n')
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const chain = adminChain('testnet')!
const CURSOR = 'owner_events_next:testnet'
const HASH: Hex = `0x${'cd'.repeat(32)}`

function fundsLog(block: number, d = 100, w = 50) {
  return {
    address: chain.factory,
    topics: encodeEventTopics({ abi: factoryAbi, eventName: 'FeesUpdated' }),
    data: encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }], [d, w]),
    blockNumber: numberToHex(block),
    transactionHash: HASH,
    logIndex: '0x0',
    removed: false,
  }
}

type World = {
  head: number
  logs: (from: bigint, to: bigint) => unknown[]
  getLogsFails: boolean
  telegramOk: boolean
  sent: string[]
  getLogsCalls: [bigint, bigint][]
}

function world(over: Partial<World> = {}): World & { fetcher: typeof fetch } {
  const w: World = { head: 1000, logs: () => [], getLogsFails: false, telegramOk: true, sent: [], getLogsCalls: [], ...over }
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://fundit.fun/') return new Response('', { status: 200 })
    if (url === 'https://fundit.fun/api/ucw/wallets') return new Response('{}', { status: 401 })
    if (url === chain.rpcUrl) {
      const body = JSON.parse(init!.body as string)
      if (body.method === 'eth_blockNumber') return Response.json({ jsonrpc: '2.0', id: 1, result: numberToHex(w.head) })
      if (body.method === 'eth_getLogs') {
        const from = BigInt(body.params[0].fromBlock)
        const to = BigInt(body.params[0].toBlock)
        w.getLogsCalls.push([from, to])
        if (w.getLogsFails) return new Response('x', { status: 500 })
        return Response.json({ jsonrpc: '2.0', id: 1, result: w.logs(from, to) })
      }
    }
    if (url.startsWith('https://api.telegram.org/')) {
      if (!w.telegramOk) return new Response('{}', { status: 502 })
      w.sent.push(JSON.parse(init!.body as string).text)
      return new Response('{"ok":true}', { status: 200 })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return Object.assign(w, { fetcher })
}

function env(over: Partial<Env> = {}): Env & { ADMIN_DB: ReturnType<typeof sqliteDb> } {
  return { NETWORK: 'testnet', ADMIN_DB: sqliteDb(SCHEMA), TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '7', ...over } as Env & { ADMIN_DB: ReturnType<typeof sqliteDb> }
}

const meta = async (e: Env, key: string) => (await e.ADMIN_DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null

afterEach(() => vi.restoreAllMocks())

describe('runCron', () => {
  it('first run starts at head without replaying history', async () => {
    const e = env()
    const w = world({ logs: () => [fundsLog(5)] })
    await runCron(e, NOW, w.fetcher)
    expect(w.sent).toEqual(['[Arc Testnet] Owner alerts started at block 998 on Arc Testnet.'])
    expect(w.getLogsCalls).toEqual([])
    expect(await meta(e, CURSOR)).toBe('998')
    // The next run scans from the cursor, and the new event is sent.
    w.head = 1005
    w.logs = () => [fundsLog(1001)]
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(w.getLogsCalls).toEqual([[998n, 1003n]])
    expect(w.sent[1]).toBe(`[Arc Testnet] Fees changed to 100 bps on gifts and 50 bps on withdrawals. https://explorer.testnet.arc.io/tx/${HASH}`)
    expect(await meta(e, CURSOR)).toBe('1004')
  })

  it('caps one run at 5 windows', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.head = 998 + 2 + 10_000 * 8 - 1
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(w.getLogsCalls).toHaveLength(5)
    expect(await meta(e, CURSOR)).toBe(String(998 + 5 * 10_000))
    await runCron(e, NOW + 600_000, w.fetcher)
    expect(w.getLogsCalls).toHaveLength(8)
  })

  // The cursor is only moved once the RPC has answered, so a bad run cannot skip blocks.
  it('a failed getLogs leaves the cursor where it was', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.head = 1100
    w.getLogsFails = true
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(await meta(e, CURSOR)).toBe('998')
  })

  it('keeps the cursor when Telegram fails, so the event is sent next run', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.head = 1010
    w.logs = () => [fundsLog(1001)]
    w.telegramOk = false
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(await meta(e, CURSOR)).toBe('998')
    expect(w.sent).toHaveLength(1)
    w.telegramOk = true
    await runCron(e, NOW + 600_000, w.fetcher)
    expect(w.sent).toHaveLength(2)
    expect(w.sent[1]).toContain('Fees changed to 100 bps')
    expect(await meta(e, CURSOR)).toBe('1009')
  })

  it('does not set the cursor when the first message fails to send', async () => {
    const e = env()
    const w = world({ telegramOk: false })
    await runCron(e, NOW, w.fetcher)
    expect(await meta(e, CURSOR)).toBeNull()
  })

  it('prunes expired nonces', async () => {
    const e = env()
    await e.ADMIN_DB.prepare('INSERT INTO nonces (nonce, expires_at) VALUES (?, ?), (?, ?)').bind('old', NOW - 1, 'live', NOW + 1000).run()
    await runCron(e, NOW, world().fetcher)
    const rows = await e.ADMIN_DB.prepare('SELECT nonce FROM nonces').all<{ nonce: string }>()
    expect(rows.results.map((r) => r.nonce)).toEqual(['live'])
  })

  it('runs the checks without Telegram secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const e = env({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined })
    const w = world()
    await runCron(e, NOW, w.fetcher)
    expect(log.mock.calls).toEqual([['telegram not configured']])
    expect(w.sent).toEqual([])
    expect(await meta(e, 'rpc_head:testnet')).toBe('1000')
    expect(await meta(e, CURSOR)).toBeNull()
  })

  it('alerts on a failing check after two runs', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    const base = w.fetcher
    const broken = ((input: string, init?: RequestInit) => (String(input) === 'https://fundit.fun/' ? Promise.resolve(new Response('', { status: 500 })) : base(input, init))) as typeof fetch
    await runCron(e, NOW + 300_000, broken)
    expect(w.sent).toHaveLength(1)
    await runCron(e, NOW + 600_000, broken)
    expect(w.sent[1]).toBe('[Arc Testnet] site is failing: status 500')
  })
})
