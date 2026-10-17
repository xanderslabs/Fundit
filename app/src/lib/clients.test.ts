import { createPublicClient } from 'viem'
import { arc } from 'viem/chains'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXTERNAL_HOSTS } from '../config'
import { arcRpcUrls, arcTransport } from './clients'

afterEach(() => {
  vi.unstubAllGlobals()
})

type RpcBody = { id: number; method: string } | { id: number; method: string }[]

describe('arcRpcUrls', () => {
  // One public RPC is a single point of failure for every page. viem's arc chain lists Arc's other public RPCs.
  it('puts the configured RPC first, then the other Arc RPCs from viem', () => {
    expect(arcRpcUrls('https://rpc.mainnet.arc.io')).toEqual([
      'https://rpc.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
    ])
    expect(arcRpcUrls('https://rpc.drpc.mainnet.arc.io')[0]).toBe('https://rpc.drpc.mainnet.arc.io')
    expect(arcRpcUrls('https://rpc.drpc.mainnet.arc.io')).toHaveLength(4)
  })

  // A local fork has its own state. Falling back to mainnet would mix two chains' answers.
  it('uses only a local RPC, with no mainnet fallback', () => {
    expect(arcRpcUrls('http://127.0.0.1:8545')).toEqual(['http://127.0.0.1:8545'])
    expect(arcRpcUrls('http://localhost:8545')).toEqual(['http://localhost:8545'])
  })

  // config.test.ts checks every EXTERNAL_HOSTS entry against the CSP connect-src.
  it('lists every fallback RPC in EXTERNAL_HOSTS', () => {
    for (const url of arcRpcUrls('https://rpc.mainnet.arc.io')) expect(EXTERNAL_HOSTS).toContain(url)
  })
})

describe('arcTransport', () => {
  it('falls back to the next RPC when the first one fails', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        asked.push(url)
        if (url.startsWith('https://first.')) return new Response('down', { status: 503 })
        const body = JSON.parse(String(init?.body)) as RpcBody
        const answer = (r: { id: number }) => ({ jsonrpc: '2.0', id: r.id, result: '0x10' })
        return Response.json(Array.isArray(body) ? body.map(answer) : answer(body))
      }),
    )
    const client = createPublicClient({ chain: arc, transport: arcTransport(['https://first.example', 'https://second.example']) })
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(16n)
    expect(asked.some((u) => u.startsWith('https://first.'))).toBe(true)
    expect(asked.at(-1)).toMatch(/^https:\/\/second\./)
  })
})
