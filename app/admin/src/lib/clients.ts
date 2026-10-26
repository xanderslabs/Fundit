import { createPublicClient, http, type PublicClient } from 'viem'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'

const read = new Map<AdminNetwork, PublicClient>()
const scan = new Map<AdminNetwork, PublicClient>()

// One read client per network, made on first use. Calls go out as JSON-RPC batches.
export function readClient(network: AdminNetwork): PublicClient {
  let client = read.get(network)
  if (!client) {
    const n = ADMIN_NETWORKS[network]
    client = createPublicClient({ chain: n.chain, transport: http(n.rpcUrl, { batch: true }) }) as PublicClient
    read.set(network, client)
  }
  return client
}

// The history scan's client: same RPC, one call per request and no retries, so the scan decides how to retry.
export function scanClient(network: AdminNetwork): PublicClient {
  let client = scan.get(network)
  if (!client) {
    const n = ADMIN_NETWORKS[network]
    client = createPublicClient({ chain: n.chain, transport: http(n.rpcUrl, { retryCount: 0 }) }) as PublicClient
    scan.set(network, client)
  }
  return client
}
