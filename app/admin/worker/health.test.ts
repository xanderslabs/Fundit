// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adminChain } from './chain'
import { runChecks, type Check } from './health'

const chain = adminChain('testnet')!

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

describe('runChecks', () => {
  it('passes when everything answers as expected', async () => {
    const { checks, head } = await runChecks(chain, 99n, stub({}))
    expect(checks.map((c) => [c.key, c.ok])).toEqual([['site', true], ['ucw', true], ['rpc:arc-testnet', true]])
    expect(head).toBe(100n)
  })

  // 401 is the healthy answer (no session). 503 means the fundit Worker lost its config.
  it('ucw check expects 401 and fails on 503', async () => {
    expect(byKey((await runChecks(chain, null, stub({ ucw: 401 }))).checks, 'ucw').ok).toBe(true)
    const bad = byKey((await runChecks(chain, null, stub({ ucw: 503 }))).checks, 'ucw')
    expect(bad).toMatchObject({ ok: false, detail: 'fundit Worker config' })
    expect(byKey((await runChecks(chain, null, stub({ ucw: 200 }))).checks, 'ucw').ok).toBe(false)
  })

  // A node that answers but is stuck serves old data, which would silently blind the owner-event scan.
  it('rpc check fails when the head does not advance', async () => {
    const { checks, head } = await runChecks(chain, 100n, stub({ head: '0x64' }))
    expect(byKey(checks, 'rpc:arc-testnet').ok).toBe(false)
    expect(head).toBe(100n)
  })

  it('a timeout fails the check without throwing', async () => {
    const { checks, head } = await runChecks(chain, 5n, stub({ head: 'timeout' }))
    expect(byKey(checks, 'rpc:arc-testnet').ok).toBe(false)
    expect(head).toBeNull()
    const all = await runChecks(chain, null, (async () => { throw new DOMException('t', 'TimeoutError') }) as typeof fetch)
    expect(all.checks.every((c) => !c.ok)).toBe(true)
  })
})
