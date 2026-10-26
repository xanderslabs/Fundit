// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ADMIN_CHAINS } from './chain'
import { runChecks, type Check } from './health'

const chain = ADMIN_CHAINS.testnet

type Routes = { site?: number; ucw?: number; head?: string | 'error' | 'timeout' }

function stub(routes: Routes): typeof fetch {
  return (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://fundit.fun/') return new Response('<html>', { status: routes.site ?? 200 })
    if (url === 'https://fundit.fun/api/ucw/wallets') {
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).origin ?? (init?.headers as Record<string, string>).Origin).toBe('https://fundit.fun')
      expect(init?.body).toBe('{}')
      return new Response('{}', { status: routes.ucw ?? 401 })
    }
    if (url === chain.rpcUrl) {
      if (routes.head === 'timeout') throw new DOMException('timed out', 'TimeoutError')
      if (routes.head === 'error') return new Response('x', { status: 500 })
      return Response.json({ jsonrpc: '2.0', id: 1, result: routes.head ?? '0x64' })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
}

const byKey = (checks: Check[], key: string) => checks.find((c) => c.key === key)!

const one = (last: bigint | null, f: typeof fetch) => runChecks([chain], { mainnet: null, testnet: last }, f)

describe('runChecks', () => {
  it('passes when everything answers as expected', async () => {
    const { checks, heads } = await one(99n, stub({}))
    expect(checks.map((c) => [c.key, c.ok])).toEqual([['site', true], ['ucw', true], ['rpc:arc-testnet', true]])
    expect(heads.testnet).toBe(100n)
  })

  // 401 is the healthy answer (no session). 503 means the fundit Worker lost its config.
  it('ucw check expects 401 and fails on 503', async () => {
    expect(byKey((await one(null, stub({ ucw: 401 }))).checks, 'ucw').ok).toBe(true)
    const bad = byKey((await one(null, stub({ ucw: 503 }))).checks, 'ucw')
    expect(bad).toMatchObject({ ok: false, detail: 'fundit Worker config' })
    expect(byKey((await one(null, stub({ ucw: 200 }))).checks, 'ucw').ok).toBe(false)
  })

  // A node that answers but is stuck serves old data, which would silently blind the owner-event scan.
  it('rpc check fails when the head does not advance', async () => {
    const { checks, heads } = await one(100n, stub({ head: '0x64' }))
    expect(byKey(checks, 'rpc:arc-testnet').ok).toBe(false)
    expect(heads.testnet).toBe(100n)
  })

  it('a timeout fails the check without throwing', async () => {
    const { checks, heads } = await one(5n, stub({ head: 'timeout' }))
    expect(byKey(checks, 'rpc:arc-testnet').ok).toBe(false)
    expect(heads.testnet).toBeNull()
    const all = await one(null, (async () => { throw new DOMException('t', 'TimeoutError') }) as typeof fetch)
    expect(all.checks.every((c) => !c.ok)).toBe(true)
  })

  it('with two chains checks site and ucw once and the head once per chain', async () => {
    const calls: string[] = []
    const f = (async (input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === 'https://fundit.fun/') return new Response('', { status: 200 })
      if (url === 'https://fundit.fun/api/ucw/wallets') return new Response('{}', { status: 401 })
      const body = JSON.parse(init!.body as string)
      expect(body.method).toBe('eth_blockNumber')
      return Response.json({ jsonrpc: '2.0', id: 1, result: url === ADMIN_CHAINS.mainnet.rpcUrl ? '0xc8' : '0x64' })
    }) as typeof fetch
    const { checks, heads } = await runChecks(Object.values(ADMIN_CHAINS), { mainnet: null, testnet: null }, f)
    expect(checks.map((c) => c.key)).toEqual(['site', 'ucw', 'rpc:arc-mainnet', 'rpc:arc-testnet'])
    expect(calls.filter((u) => u === 'https://fundit.fun/')).toHaveLength(1)
    expect(calls.filter((u) => u === 'https://fundit.fun/api/ucw/wallets')).toHaveLength(1)
    expect(calls.filter((u) => u === ADMIN_CHAINS.mainnet.rpcUrl)).toHaveLength(1)
    expect(calls.filter((u) => u === ADMIN_CHAINS.testnet.rpcUrl)).toHaveLength(1)
    expect(heads).toEqual({ mainnet: 200n, testnet: 100n })
  })
})
