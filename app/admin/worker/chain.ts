// The two Arc networks the admin Worker covers. Chain ID and RPC come from the fundit Worker's table, the factory
// from the deploy config, so no address or RPC is written twice.
import type { Address } from 'viem'
import { KNOWN_FACTORIES } from '../../src/deployConfig'
import { NETWORKS_WORKER, type WorkerNetwork } from '../../worker/networks'

export type AdminChain = { network: WorkerNetwork; chainId: number; rpcUrl: string; explorerUrl: string; factory: Address }

function chain(network: WorkerNetwork): AdminChain {
  const net = NETWORKS_WORKER[network]
  return { network, chainId: net.chainId, rpcUrl: net.rpcUrl, explorerUrl: net.explorerUrl, factory: KNOWN_FACTORIES[network].address }
}

export const ADMIN_CHAINS: Record<WorkerNetwork, AdminChain> = { mainnet: chain('mainnet'), testnet: chain('testnet') }
