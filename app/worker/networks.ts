// What the Worker needs per Arc network. A copy of the matching values in src/config.ts, which the Worker cannot
// import (it reads Vite's env); networks.test.ts keeps the two equal.
import type { Address } from 'viem'

export type WorkerNetwork = 'testnet' | 'mainnet'

// Arc's Multicall3From runs each inner call with the caller as msg.sender. Same address on both networks.
export const MULTICALL3_FROM: Address = '0x522fAf9A91c41c443c66765030741e4AaCe147D0'

export type WorkerNetworkConfig = {
  chainId: number
  // Circle's sign/transaction takes only EVM and EVM-TESTNET wallets (ARC and ARC-TESTNET fail with 156027).
  walletType: 'EVM-TESTNET' | 'EVM'
  rpcUrl: string
  explorerUrl: string
  usdc: Address
  eurc: Address
  tokenMessengerV2: Address
  multicall3From: Address
}

export const NETWORKS_WORKER: Record<WorkerNetwork, WorkerNetworkConfig> = {
  testnet: {
    chainId: 5042002,
    walletType: 'EVM-TESTNET',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerUrl: 'https://explorer.testnet.arc.io',
    usdc: '0x3600000000000000000000000000000000000000',
    eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    multicall3From: MULTICALL3_FROM,
  },
  mainnet: {
    chainId: 5042,
    walletType: 'EVM',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: 'https://explorer.arc.io',
    usdc: '0x3600000000000000000000000000000000000000',
    eurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    multicall3From: MULTICALL3_FROM,
  },
}
