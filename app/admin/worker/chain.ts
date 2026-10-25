// The network the admin Worker runs on, from the NETWORK var. Chain ID and RPC come from the fundit Worker's
// table, the factory from the deploy config, so no address or RPC is written twice.
import type { Address } from 'viem'
import { KNOWN_FACTORIES } from '../../src/deployConfig'
import { NETWORKS_WORKER, type WorkerNetwork } from '../../worker/networks'

export type AdminChain = { network: WorkerNetwork; chainId: number; rpcUrl: string; factory: Address }

// Null for anything but testnet or mainnet, so a missing or misspelt NETWORK refuses every request.
export function adminChain(network: string | undefined): AdminChain | null {
  if (network !== 'testnet' && network !== 'mainnet') return null
  const net = NETWORKS_WORKER[network]
  return { network, chainId: net.chainId, rpcUrl: net.rpcUrl, factory: KNOWN_FACTORIES[network].address }
}
