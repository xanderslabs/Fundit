// The two Arc networks the admin Worker covers. Chain ID and RPC come from the fundit Worker's table, the factory
// from the deploy config, so no address or RPC is written twice.
import type { Address } from 'viem'
import { KNOWN_FACTORIES } from '../../src/deployConfig'
import { NETWORKS_WORKER, rpcUrlFor, type WorkerNetwork } from '../../worker/networks'

export type AdminChain = { network: WorkerNetwork; chainId: number; rpcUrl: string; explorerUrl: string; factory: Address }

function chain(network: WorkerNetwork): AdminChain {
  const net = NETWORKS_WORKER[network]
  return { network, chainId: net.chainId, rpcUrl: net.rpcUrl, explorerUrl: net.explorerUrl, factory: KNOWN_FACTORIES[network].address }
}

export const ADMIN_CHAINS: Record<WorkerNetwork, AdminChain> = { mainnet: chain('mainnet'), testnet: chain('testnet') }

export type RpcSecrets = { ARC_MAINNET_RPC_URL?: string; ARC_TESTNET_RPC_URL?: string }

// ADMIN_CHAINS with each network's RPC taken from its Worker secret when one is set.
export function adminChains(env: RpcSecrets): Record<WorkerNetwork, AdminChain> {
  return {
    mainnet: { ...ADMIN_CHAINS.mainnet, rpcUrl: rpcUrlFor('mainnet', env.ARC_MAINNET_RPC_URL) },
    testnet: { ...ADMIN_CHAINS.testnet, rpcUrl: rpcUrlFor('testnet', env.ARC_TESTNET_RPC_URL) },
  }
}
