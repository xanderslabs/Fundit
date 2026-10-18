import { createPublicClient, fallback, http } from 'viem'
import { base, mainnet } from 'viem/chains'
import { ARC_CHAIN, ARC_RPC_URL, ARC_RPC_FALLBACKS, BASE_RPC_URL, MAINNET_RPC_URL } from '../config'

// The configured Arc RPC first, then Arc's other public RPCs that viem lists. A local node (a fork, for example)
// has its own state, so it gets no mainnet fallback.
export function arcRpcUrls(primary: string): string[] {
  const { hostname } = new URL(primary)
  if (hostname === '127.0.0.1' || hostname === 'localhost') return [primary]
  return [primary, ...ARC_RPC_FALLBACKS.filter((u) => u !== primary)]
}

// Batched calls to each RPC, moving to the next one when an RPC fails.
export function arcTransport(urls: readonly string[]) {
  return fallback(urls.map((u) => http(u, { batch: true })))
}

// Read-only Arc client for campaign reads. Writes go through the wallet, not this client.
export const arcClient = createPublicClient({ chain: ARC_CHAIN, transport: arcTransport(arcRpcUrls(ARC_RPC_URL)) })

// Ethereum mainnet, only for ENS names and Basenames. A page full of cards asks for many names at once,
// so the calls go out as JSON-RPC batches.
export const mainnetClient = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC_URL, { batch: true }) })

// Base mainnet, only for Basenames, on both networks. Uses the same public Base RPC as the mainnet CCTP route.
export const baseClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL, { batch: true }) })
