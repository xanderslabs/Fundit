import { type Address, type Chain, type Hex, parseAbi } from 'viem'
import { arbitrum, arc, arcTestnet, avalanche, base, baseSepolia, mainnet, optimism, polygon, sepolia } from 'viem/chains'
import { type ArcNetwork, loadConfig, parseArcNetwork } from './deployConfig'

export type TokenSymbol = 'USDC' | 'EURC'

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

// Everything that differs between Arc mainnet and Arc testnet. Values are checked on-chain; see
// .superpowers/sdd/2026-10-18-fundit-plan-5-passkey-only-testnet/task-1-report.md.
export type NetworkConfig = {
  name: ArcNetwork
  // viem chain, with the RPC and explorer the app uses.
  chain: Chain
  // Arc's CCTP domain, 26 on both networks.
  domain: 26
  rpcUrl: string
  explorerUrl: string
  // ERC-20 interface (6 decimals), never the 18-decimal native balance.
  usdc: Address
  eurc: Address
  // Same address on Arc and on every CCTP source chain of the network.
  tokenMessengerV2: Address
  memo: Address
  gatewayWallet: Address
  gatewayMinter: Address
  irisUrl: string
  gatewayUrl: string
  // Appended to the Modular Wallets client URL for the Arc bundler transport.
  modularChainPath: '/arc' | '/arcTestnet'
  cctpChains: readonly CctpChain[]
  // The names people see for each chain.
  chainLabels: Record<'Arc' | CctpChainKey, string>
}

const env = import.meta.env

// Free public RPCs. Every host here must also be in public/_headers connect-src.
export const MAINNET_RPC_URL: string = env.VITE_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'
// Base mainnet, for Basenames on both networks and the Base CCTP route on mainnet.
export const BASE_RPC_URL = 'https://mainnet.base.org'

const ARC_TESTNET_RPC_URL = 'https://rpc.testnet.arc.io'
const ARC_TESTNET_EXPLORER_URL = 'https://explorer.testnet.arc.io'

export const NETWORKS: Record<ArcNetwork, NetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    chain: arc,
    domain: 26,
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: arc.blockExplorers.default.url,
    usdc: '0x3600000000000000000000000000000000000000',
    eurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    memo: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
    gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
    gatewayMinter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205',
    irisUrl: 'https://iris-api.circle.com',
    gatewayUrl: 'https://gateway-api.circle.com',
    modularChainPath: '/arc',
    cctpChains: [
      { key: 'Ethereum', chainId: 1, domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', viemChain: mainnet, rpcUrl: MAINNET_RPC_URL, fast: true },
      { key: 'Avalanche', chainId: 43114, domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', viemChain: avalanche, rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', fast: false },
      { key: 'Optimism', chainId: 10, domain: 2, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', viemChain: optimism, rpcUrl: 'https://mainnet.optimism.io', fast: true },
      { key: 'Arbitrum', chainId: 42161, domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', viemChain: arbitrum, rpcUrl: 'https://arb1.arbitrum.io/rpc', fast: true },
      { key: 'Base', chainId: 8453, domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', viemChain: base, rpcUrl: BASE_RPC_URL, fast: true },
      { key: 'Polygon', chainId: 137, domain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', viemChain: polygon, rpcUrl: 'https://polygon.drpc.org', fast: false },
    ],
    // Optimism's own name for its chain is OP Mainnet.
    chainLabels: { Arc: 'Arc', Ethereum: 'Ethereum', Avalanche: 'Avalanche', Optimism: 'OP Mainnet', Arbitrum: 'Arbitrum', Base: 'Base', Polygon: 'Polygon' },
  },
  testnet: {
    name: 'testnet',
    // viem's arcTestnet lists older .arc.network hosts. The Arc docs and the CSP use .arc.io.
    chain: {
      ...arcTestnet,
      rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
      blockExplorers: { default: { name: 'Arc Testnet Explorer', url: ARC_TESTNET_EXPLORER_URL } },
    },
    domain: 26,
    rpcUrl: ARC_TESTNET_RPC_URL,
    explorerUrl: ARC_TESTNET_EXPLORER_URL,
    usdc: '0x3600000000000000000000000000000000000000',
    eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    memo: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
    gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
    irisUrl: 'https://iris-api-sandbox.circle.com',
    gatewayUrl: 'https://gateway-api-testnet.circle.com',
    modularChainPath: '/arcTestnet',
    // Only the two source chains whose USDC was checked on-chain. Public RPCs as viem lists them.
    cctpChains: [
      { key: 'Ethereum', chainId: sepolia.id, domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', viemChain: sepolia, rpcUrl: sepolia.rpcUrls.default.http[0], fast: true },
      { key: 'Base', chainId: baseSepolia.id, domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', viemChain: baseSepolia, rpcUrl: baseSepolia.rpcUrls.default.http[0], fast: true },
    ],
    chainLabels: {
      Arc: 'Arc Testnet',
      Ethereum: 'Ethereum Sepolia',
      Avalanche: 'Avalanche Fuji',
      Optimism: 'OP Sepolia',
      Arbitrum: 'Arbitrum Sepolia',
      Base: 'Base Sepolia',
      Polygon: 'Polygon Amoy',
    },
  },
}

// The network this build runs on (VITE_ARC_NETWORK, mainnet by default).
export const NETWORK: NetworkConfig = NETWORKS[parseArcNetwork(env.VITE_ARC_NETWORK)]

export const ARC_CHAIN: Chain = NETWORK.chain
export const ARC_CHAIN_ID: number = NETWORK.chain.id
export const ARC_DOMAIN = NETWORK.domain
export const EXPLORER_URL: string = NETWORK.explorerUrl

// Amounts always use the ERC-20 interface (6 decimals), never the 18-decimal native balance.
export const TOKENS: Record<TokenSymbol, { address: Address; decimals: 6; symbol: TokenSymbol }> = {
  USDC: { address: NETWORK.usdc, decimals: 6, symbol: 'USDC' },
  EURC: { address: NETWORK.eurc, decimals: 6, symbol: 'EURC' },
}

export const MEMO_ADDRESS: Address = NETWORK.memo
export const TOKEN_MESSENGER_V2: Address = NETWORK.tokenMessengerV2

// Used as the wagmi transport for Arc. VITE_ARC_RPC_URL overrides it (the e2e fork).
export const ARC_RPC_URL: string = env.VITE_ARC_RPC_URL || NETWORK.rpcUrl
// Arc's public RPCs as the network's viem chain lists them, the fallbacks for Arc reads. Hosts under *.arc.io.
export const ARC_RPC_FALLBACKS: readonly string[] = NETWORK.chain.rpcUrls.default.http

export const CCTP_CHAINS: readonly CctpChain[] = NETWORK.cctpChains
export const CHAIN_LABELS: Record<'Arc' | CctpChainKey, string> = NETWORK.chainLabels

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
// Arc network fees are paid in USDC from the sender's own balance. This much stays free for them (a Fundit
// account, and a regular wallet adding USDC to one).
export const PASSKEY_GAS_BUFFER = 50_000n
// Donations from another chain and from a Gateway unified balance, and bridging into a passkey wallet. Off by
// default. Entries already saved in the browser are tracked and still block a second donation either way.
export const CROSSCHAIN_ENABLED: boolean = env.VITE_CROSSCHAIN === '1'

export const IRIS_URL: string = NETWORK.irisUrl
export const GATEWAY_URL: string = NETWORK.gatewayUrl
export const MODULAR_WALLETS_URL = 'https://modular-sdk.circle.com'

// Public RPC limits: 10,000 blocks and 2,000 logs per eth_getLogs.
export const MAX_LOG_RANGE = 10_000n
export const MAX_LOGS = 2000
export const TX_TIMEOUT_MS = 60_000
export const MAX_MESSAGE_BYTES = 280

// Every external origin a network's build calls. config.test.ts checks each one against the CSP connect-src.
export function networkHosts(n: NetworkConfig): string[] {
  return [
    n.rpcUrl,
    ...n.chain.rpcUrls.default.http,
    MAINNET_RPC_URL,
    BASE_RPC_URL,
    ...n.cctpChains.map((c) => c.rpcUrl),
    n.irisUrl,
    n.gatewayUrl,
    MODULAR_WALLETS_URL,
  ]
}

export const EXTERNAL_HOSTS: readonly string[] = [ARC_RPC_URL, ...networkHosts(NETWORK)]

// TODO before launch: replace placeholder social handles
export const SOCIAL_LINKS: readonly { name: string; href: string; icon: string }[] = [
  { name: 'X', href: 'https://x.com/fundit', icon: '/images/x.svg' },
  { name: 'Telegram', href: 'https://t.me/fundit', icon: '/images/telegram.svg' },
  { name: 'Discord', href: 'https://discord.gg/fundit', icon: '/images/discord.svg' },
  { name: 'Instagram', href: 'https://instagram.com/fundit', icon: '/images/instagram.svg' },
]
