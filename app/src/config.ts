import { type Address, type Chain, type Hex, parseAbi } from 'viem'
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from 'viem/chains'
import { loadConfig } from './deployConfig'

// Arc mainnet
export const ARC_CHAIN_ID = 5042
export const ARC_DOMAIN = 26

export type TokenSymbol = 'USDC' | 'EURC'

// Amounts always use the ERC-20 interface (6 decimals), never the 18-decimal native balance.
export const TOKENS: Record<TokenSymbol, { address: Address; decimals: 6; symbol: TokenSymbol }> = {
  USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6, symbol: 'USDC' },
  EURC: { address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6, symbol: 'EURC' },
}

export const MEMO_ADDRESS: Address = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505'
// Same address on Arc and on every CCTP source chain below.
export const TOKEN_MESSENGER_V2: Address = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'

// CCTP Forwarding Service hook data: "cctp-forward" padded to 24 bytes, uint32 version 0, uint32 length 0.
export const FORWARD_HOOK_DATA: Hex = '0x636374702d666f72776172640000000000000000000000000000000000000000'

export type CctpChainKey = 'Ethereum' | 'Avalanche' | 'Optimism' | 'Arbitrum' | 'Base' | 'Polygon'

export type CctpChain = {
  key: CctpChainKey
  chainId: number
  domain: number
  usdc: Address
  viemChain: Chain
  rpcUrl: string
  // false where only the standard (slow) CCTP transfer is offered.
  fast: boolean
}

const env = import.meta.env

// Free public RPCs, used as wagmi transports. Every host here must also be in public/_headers connect-src.
export const ARC_RPC_URL: string = env.VITE_ARC_RPC_URL || 'https://rpc.mainnet.arc.io'
export const MAINNET_RPC_URL: string = env.VITE_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'

export const CCTP_CHAINS: readonly CctpChain[] = [
  { key: 'Ethereum', chainId: 1, domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', viemChain: mainnet, rpcUrl: MAINNET_RPC_URL, fast: true },
  { key: 'Avalanche', chainId: 43114, domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', viemChain: avalanche, rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', fast: false },
  { key: 'Optimism', chainId: 10, domain: 2, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', viemChain: optimism, rpcUrl: 'https://mainnet.optimism.io', fast: true },
  { key: 'Arbitrum', chainId: 42161, domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', viemChain: arbitrum, rpcUrl: 'https://arb1.arbitrum.io/rpc', fast: true },
  { key: 'Base', chainId: 8453, domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', viemChain: base, rpcUrl: 'https://mainnet.base.org', fast: true },
  { key: 'Polygon', chainId: 137, domain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', viemChain: polygon, rpcUrl: 'https://polygon.drpc.org', fast: false },
]

// The names people see for each chain. Optimism's own name for its chain is OP Mainnet.
export const CHAIN_LABELS: Record<'Arc' | CctpChainKey, string> = {
  Arc: 'Arc',
  Ethereum: 'Ethereum',
  Avalanche: 'Avalanche',
  Optimism: 'OP Mainnet',
  Arbitrum: 'Arbitrum',
  Base: 'Base',
  Polygon: 'Polygon',
}

// Basenames, read on Base. The L1 lookup through ENSIP-19 reverts today, so the app asks Base directly.
// ENS L2ReverseRegistrar on Base: the primary name an address has set.
export const L2_REVERSE_REGISTRAR: Address = '0x0000000000D8e504002cC26E3Ec46D81971C1664'
// Basenames registry: which resolver each *.base.eth name uses now. Owners can switch resolvers, so the
// address and avatar are read from the current one, never from a fixed resolver.
export const BASENAME_REGISTRY: Address = '0xB94704422c2a1E396835A571837Aa5AE53285a95'
export const basenameAbi = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function nameForAddr(address addr) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
])

const deploy = loadConfig(env)

// Zero in dev and test until the factory is deployed and the env vars are set.
export const FACTORY_ADDRESS: Address = deploy.factoryAddress
export const FACTORY_DEPLOY_BLOCK: bigint = deploy.factoryDeployBlock
export const REOWN_PROJECT_ID: string = deploy.reownProjectId
export const CIRCLE_CLIENT_KEY: string = env.VITE_CIRCLE_CLIENT_KEY ?? ''
export const PASSKEYS_ENABLED: boolean = env.VITE_PASSKEYS === '1'

export const IRIS_URL = 'https://iris-api.circle.com'
export const GATEWAY_URL = 'https://gateway-api.circle.com'
export const MODULAR_WALLETS_URL = 'https://modular-sdk.circle.com'

// Public RPC limits: 10,000 blocks and 2,000 logs per eth_getLogs.
export const MAX_LOG_RANGE = 10_000n
export const MAX_LOGS = 2000
export const TX_TIMEOUT_MS = 60_000
export const MAX_MESSAGE_BYTES = 280

// Every external origin the app calls. config.test.ts checks each one against the CSP connect-src.
export const EXTERNAL_HOSTS: readonly string[] = [
  ARC_RPC_URL,
  ...CCTP_CHAINS.map((c) => c.rpcUrl),
  IRIS_URL,
  GATEWAY_URL,
  MODULAR_WALLETS_URL,
]
