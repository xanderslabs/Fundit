// @vitest-environment node
import { readFileSync } from 'node:fs'
import { encodeAbiParameters, encodeEventTopics, numberToHex, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { factoryAbi } from '../../src/abi/factory'
import { ADMIN_CHAINS } from './chain'
import { EVENTS_STALE_MS, runCron } from './cron'
import { sqliteDb } from './testing/sqliteDb'
import type { Env } from './index'

const SCHEMA = ['0001_nonces.sql', '0002_alerts.sql'].map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n')
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const chain = ADMIN_CHAINS.testnet
const main = ADMIN_CHAINS.mainnet
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
  // Mainnet's head moves forward by one on every read so its RPC check stays healthy across runs.
  mainHead: number
  mainRpcFails: boolean
  mainLogsCalls: [bigint, bigint][]
  calls: number
}

function world(over: Partial<World> = {}): World & { fetcher: typeof fetch } {
  const w: World = { head: 1000, logs: () => [], getLogsFails: false, telegramOk: true, sent: [], getLogsCalls: [], mainHead: 5000, mainRpcFails: false, mainLogsCalls: [], calls: 0, ...over }
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    w.calls++
    if (url === main.rpcUrl) {
      if (w.mainRpcFails) return new Response('x', { status: 500 })
      const body = JSON.parse(init!.body as string)
      if (body.method === 'eth_blockNumber') return Response.json({ jsonrpc: '2.0', id: 1, result: numberToHex(w.mainHead++) })
      if (body.method === 'eth_getLogs') {
        w.mainLogsCalls.push([BigInt(body.params[0].fromBlock), BigInt(body.params[0].toBlock)])
        return Response.json({ jsonrpc: '2.0', id: 1, result: [] })
      }
    }
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
  return { ADMIN_DB: sqliteDb(SCHEMA), TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '7', ...over } as Env & { ADMIN_DB: ReturnType<typeof sqliteDb> }
}

const meta = async (e: Env, key: string) => (await e.ADMIN_DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null

// Messages for one network, so each test reads its own network's alerts.
const tn = (w: { sent: string[] }) => w.sent.filter((s) => s.startsWith('[Arc Testnet]'))

afterEach(() => vi.restoreAllMocks())

describe('runCron', () => {
  it('first run starts at head without replaying history', async () => {
    const e = env()
    const w = world({ logs: () => [fundsLog(5)] })
    await runCron(e, NOW, w.fetcher)
    expect(tn(w)).toEqual(['[Arc Testnet] Owner alerts started at block 998 on Arc Testnet.'])
    expect(w.getLogsCalls).toEqual([])
    expect(await meta(e, CURSOR)).toBe('998')
    // The next run scans from the cursor, and the new event is sent.
    w.head = 1005
    w.logs = () => [fundsLog(1001)]
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(w.getLogsCalls).toEqual([[998n, 1003n]])
    expect(tn(w)[1]).toBe(`[Arc Testnet] Fees changed to 100 bps on gifts and 50 bps on withdrawals. https://explorer.testnet.arc.io/tx/${HASH}`)
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
    expect(tn(w)).toHaveLength(1)
    w.telegramOk = true
    await runCron(e, NOW + 600_000, w.fetcher)
    expect(tn(w)).toHaveLength(2)
    expect(tn(w)[1]).toContain('Fees changed to 100 bps')
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
    // Only the two "Owner alerts started" messages so far.
    expect(w.sent).toHaveLength(2)
    await runCron(e, NOW + 600_000, broken)
    expect(w.sent[2]).toBe('[Fundit] site is failing: status 500')
  })

  // The RPC drops some calls from Cloudflare. Short gaps lose no events, so they must not reach the chat.
  it('stays quiet while the owner event scan fails for less than 30 minutes', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.getLogsFails = true
    for (let t = 300_000; t < EVENTS_STALE_MS; t += 300_000) {
      w.head++
      await runCron(e, NOW + t, w.fetcher)
    }
    expect(tn(w)).toHaveLength(1)
    expect(await meta(e, CURSOR)).toBe('998')
  })

  it('alerts once the owner event scan has failed for 30 minutes', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.getLogsFails = true
    w.head = 1100
    await runCron(e, NOW + EVENTS_STALE_MS, w.fetcher)
    expect(tn(w)).toHaveLength(1)
    w.head = 1101
    await runCron(e, NOW + EVENTS_STALE_MS + 300_000, w.fetcher)
    expect(tn(w)[1]).toBe('[Arc Testnet] events:arc-testnet is failing: owner events not read for 30 minutes')
    expect(await meta(e, CURSOR)).toBe('998')
  })

  it('sends back to normal when the owner event scan recovers', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.getLogsFails = true
    w.head = 1100
    await runCron(e, NOW + EVENTS_STALE_MS, w.fetcher)
    w.head = 1101
    await runCron(e, NOW + EVENTS_STALE_MS + 300_000, w.fetcher)
    w.getLogsFails = false
    w.head = 1102
    await runCron(e, NOW + EVENTS_STALE_MS + 600_000, w.fetcher)
    expect(tn(w).at(-1)).toBe('[Arc Testnet] events:arc-testnet is back to normal.')
  })

  it('does not report the owner event scan as failing without Telegram secrets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const e = env({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined })
    const w = world({ getLogsFails: true })
    await runCron(e, NOW, w.fetcher)
    const rows = await e.ADMIN_DB.prepare('SELECT key FROM alert_state').all<{ key: string }>()
    expect(rows.results.map((r) => r.key)).not.toContain('events:arc-testnet')
  })

  it('scans owner events on both networks with separate cursors', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    expect(await meta(e, 'owner_events_next:testnet')).toBe('998')
    expect(await meta(e, 'owner_events_next:mainnet')).toBe('4998')
    expect(w.sent).toHaveLength(2)
    expect(w.sent.filter((s) => s.startsWith('[Arc Testnet] Owner alerts started'))).toHaveLength(1)
    expect(w.sent.filter((s) => s.startsWith('[Arc Mainnet] Owner alerts started'))).toHaveLength(1)
  })

  // The public mainnet RPC answers Cloudflare with 429. With a provider secret set, no call may go to it.
  it('uses the provider RPC secrets for every chain call', async () => {
    const urls: string[] = []
    const w = world()
    const providers: Record<string, string> = { 'https://main.example.org/KEY': main.rpcUrl, 'https://test.example.org/KEY': chain.rpcUrl }
    const fetcher = ((input: string, init?: RequestInit) => {
      urls.push(String(input))
      const real = providers[String(input)]
      return w.fetcher(real ?? input, init)
    }) as typeof fetch
    const e = env({ ARC_MAINNET_RPC_URL: 'https://main.example.org/KEY', ARC_TESTNET_RPC_URL: 'https://test.example.org/KEY' })
    await runCron(e, NOW, fetcher)
    w.head = 1100
    await runCron(e, NOW + 300_000, fetcher)
    expect(urls).toContain('https://main.example.org/KEY')
    expect(urls).toContain('https://test.example.org/KEY')
    expect(urls).not.toContain(main.rpcUrl)
    expect(urls).not.toContain(chain.rpcUrl)
  })

  it('a failing mainnet RPC does not stop the testnet scan', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.mainRpcFails = true
    w.head = 1005
    await runCron(e, NOW + 300_000, w.fetcher)
    w.head = 1010
    await runCron(e, NOW + 600_000, w.fetcher)
    expect(await meta(e, CURSOR)).toBe('1009')
    const row = await e.ADMIN_DB.prepare('SELECT failing FROM alert_state WHERE key = ?').bind('rpc:arc-mainnet').first<{ failing: number }>()
    expect(row?.failing).toBe(1)
    expect(w.sent).toContain('[Arc Mainnet] rpc:arc-mainnet is failing: no answer')
  })

  it('prefixes site and ucw alerts with [Fundit]', async () => {
    const e = env()
    const w = world()
    const base = w.fetcher
    const broken = ((input: string, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://fundit.fun/') return Promise.resolve(new Response('', { status: 500 }))
      if (url === 'https://fundit.fun/api/ucw/wallets') return Promise.resolve(new Response('{}', { status: 503 }))
      return base(input, init)
    }) as typeof fetch
    await runCron(e, NOW, broken)
    await runCron(e, NOW + 300_000, broken)
    expect(w.sent).toContain('[Fundit] site is failing: status 500')
    expect(w.sent).toContain('[Fundit] ucw is failing: fundit Worker config')
    // Each is alerted once per run, not once per network.
    expect(w.sent.filter((s) => s.includes('site is failing'))).toHaveLength(1)
  })

  // Cloudflare's free plan allows 50 subrequests per invocation.
  it('stays under 45 subrequests in a run with both networks at the window cap', async () => {
    const e = env()
    const w = world()
    await runCron(e, NOW, w.fetcher)
    w.head = 998 + 2 + 10_000 * 8 - 1
    w.mainHead = 4998 + 2 + 10_000 * 8 - 1
    w.calls = 0
    await runCron(e, NOW + 300_000, w.fetcher)
    expect(w.getLogsCalls).toHaveLength(5)
    expect(w.mainLogsCalls).toHaveLength(5)
    expect(w.calls).toBeLessThan(45)
  })
})
