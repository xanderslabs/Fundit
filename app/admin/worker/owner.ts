// CampaignFactory.owner(), the one wallet that may use the panel. Read with a raw eth_call so that any RPC error
// or odd answer throws: an error is never taken to be an owner.
import { getAddress, type Address } from 'viem'

export const OWNER_CACHE_MS = 60_000

const OWNER_SELECTOR = '0x8da5cb5b'
const RPC_TIMEOUT_MS = 4_000
// One 32-byte word: 12 zero bytes, then the address.
const ADDRESS_WORD = /^0x0{24}([0-9a-fA-F]{40})$/

export async function readOwner(rpcUrl: string, factory: Address): Promise<Address> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: factory, data: OWNER_SELECTOR }, 'latest'] }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (res.status !== 200) throw new Error(`RPC ${res.status}`)
  const out = (await res.json()) as { result?: unknown; error?: unknown }
  if (out.error !== undefined || typeof out.result !== 'string') throw new Error('RPC gave no result')
  const match = ADDRESS_WORD.exec(out.result)
  if (!match || /^0+$/.test(match[1] as string)) throw new Error('RPC gave no owner')
  return getAddress(`0x${match[1]}`)
}

// Per isolate. Session checks use it; login always reads fresh.
const cache = new Map<string, { owner: Address; atMs: number }>()

export async function cachedOwner(rpcUrl: string, factory: Address, nowMs: number): Promise<Address> {
  const key = `${rpcUrl} ${factory.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && nowMs >= hit.atMs && nowMs - hit.atMs < OWNER_CACHE_MS) return hit.owner
  const owner = await readOwner(rpcUrl, factory)
  cache.set(key, { owner, atMs: nowMs })
  return owner
}

export function clearOwnerCache(): void {
  cache.clear()
}
