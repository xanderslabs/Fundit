// The health checks: site, ucw and one RPC check per chain. Each has a 5 second timeout and turns every failure into a failed Check, never a throw.
// One subrequest each for site and ucw, plus one per chain.
import type { AdminChain } from './chain'
import type { WorkerNetwork } from '../../worker/networks'

export type Check = { key: string; ok: boolean; detail: string }

const TIMEOUT_MS = 5_000
const SITE = 'https://fundit.fun'

const failed = (key: string, detail: string): Check => ({ key, ok: false, detail })

async function site(fetcher: typeof fetch): Promise<Check> {
  try {
    const res = await fetcher(`${SITE}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res.status === 200 ? { key: 'site', ok: true, detail: 'ok' } : failed('site', `status ${res.status}`)
  } catch {
    return failed('site', 'no answer')
  }
}

// Signed out, the fundit Worker answers 401. 503 means its own config is broken.
async function ucw(fetcher: typeof fetch): Promise<Check> {
  try {
    const res = await fetcher(`${SITE}/api/ucw/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401) return { key: 'ucw', ok: true, detail: 'ok' }
    return failed('ucw', res.status === 503 ? 'fundit Worker config' : `status ${res.status}`)
  } catch {
    return failed('ucw', 'no answer')
  }
}

async function blockNumber(chain: AdminChain, fetcher: typeof fetch): Promise<bigint | null> {
  try {
    const res = await fetcher(chain.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status !== 200) return null
    const out = (await res.json()) as { result?: unknown; error?: unknown }
    if (out.error !== undefined || typeof out.result !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(out.result)) return null
    return BigInt(out.result)
  } catch {
    return null
  }
}

export async function runChecks(
  chains: AdminChain[],
  lastHeads: Record<WorkerNetwork, bigint | null>,
  fetcher: typeof fetch = (i, n) => fetch(i, n),
): Promise<{ checks: Check[]; heads: Record<WorkerNetwork, bigint | null> }> {
  const [siteCheck, ucwCheck, ...found] = await Promise.all([site(fetcher), ucw(fetcher), ...chains.map((c) => blockNumber(c, fetcher))])
  const heads: Record<WorkerNetwork, bigint | null> = { mainnet: null, testnet: null }
  const checks: Check[] = [siteCheck, ucwCheck]
  chains.forEach((chain, i) => {
    const head = found[i] ?? null
    const lastHead = lastHeads[chain.network]
    const key = `rpc:arc-${chain.network}`
    heads[chain.network] = head
    if (head === null) checks.push(failed(key, 'no answer'))
    else if (lastHead !== null && head <= lastHead) checks.push(failed(key, `head stuck at ${head}`))
    else checks.push({ key, ok: true, detail: 'ok' })
  })
  return { checks, heads }
}
