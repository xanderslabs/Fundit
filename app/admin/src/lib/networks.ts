import type { Address, Chain } from 'viem'
import { NETWORKS } from '../../../src/config'
import { KNOWN_FACTORIES } from '../../../src/deployConfig'

export type AdminNetwork = 'mainnet' | 'testnet'

export type AdminNetworkConfig = {
  name: AdminNetwork
  label: 'Arc Mainnet' | 'Arc Testnet'
  chain: Chain
  chainId: number
  rpcUrl: string
  explorerUrl: string
  factory: Address
  deployBlock: bigint
  usdc: Address
  eurc: Address
  testCreators: readonly string[]
}

function network(name: AdminNetwork, label: AdminNetworkConfig['label']): AdminNetworkConfig {
  const n = NETWORKS[name]
  return {
    name,
    label,
    chain: n.chain,
    chainId: n.chain.id,
    rpcUrl: n.rpcUrl,
    explorerUrl: n.explorerUrl,
    factory: KNOWN_FACTORIES[name].address,
    deployBlock: KNOWN_FACTORIES[name].deployBlock,
    usdc: n.usdc,
    eurc: n.eurc,
    testCreators: n.testCreators,
  }
}

// Both Arc networks in one build. The admin panel never reads the network the public build was made for.
export const ADMIN_NETWORKS: Record<AdminNetwork, AdminNetworkConfig> = {
  mainnet: network('mainnet', 'Arc Mainnet'),
  testnet: network('testnet', 'Arc Testnet'),
}
