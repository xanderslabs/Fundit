import { type Address, type Chain, type Hex, parseAbi } from 'viem'
import { arbitrum, arc, arcTestnet, avalanche, base, baseSepolia, mainnet, optimism, polygon, sepolia } from 'viem/chains'
import { type ArcNetwork, loadConfig, parseArcNetwork, testnetRefusedOn } from './deployConfig'
import { orList } from './lib/format'

export type TokenSymbol = 'USDC' | 'EURC'

// CCTP Forwarding Service hook data: "cctp-forward" padded to 24 bytes, uint32 version 0, uint32 length 0.
export const FORWARD_HOOK_DATA: Hex = '0x636374702d666f72776172640000000000000000000000000000000000000000'

export type CctpChainKey = 'Ethereum' | 'Avalanche' | 'Optimism' | 'Arbitrum' | 'Base' | 'Polygon'

// Chain names in Circle Bridge Kit's Blockchain enum (@circle-fin/bridge-kit chains.d.ts).
export type BridgeKitChain = CctpChainKey | 'Ethereum_Sepolia' | 'Base_Sepolia'

export type CctpChain = {
  key: CctpChainKey
  chainId: number
  domain: number
  usdc: Address
  viemChain: Chain
  rpcUrl: string
  // false where only the standard (slow) CCTP transfer is offered.
  fast: boolean
  bridgeKitChain: BridgeKitChain
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
  irisUrl: string
  // Appended to the Modular Wallets client URL for the Arc bundler transport.
  modularChainPath: '/arc' | '/arcTestnet'
  cctpChains: readonly CctpChain[]
  // Arc's name in Circle Bridge Kit.
  bridgeKitChain: 'Arc' | 'Arc_Testnet'
  // The names people see for each chain.
  chainLabels: Record<'Arc' | CctpChainKey, string>
}

// Vite fills import.meta.env. The e2e suite also reads NETWORKS in Node, where there is none. Each value is read
// by name, so the bundle inlines only these values and never the whole env object.
const env = {
  PROD: import.meta.env?.PROD ?? false,
  VITE_ARC_NETWORK: import.meta.env?.VITE_ARC_NETWORK,
  VITE_ARC_RPC_URL: import.meta.env?.VITE_ARC_RPC_URL,
  VITE_MAINNET_RPC_URL: import.meta.env?.VITE_MAINNET_RPC_URL,
  VITE_FACTORY_ADDRESS: import.meta.env?.VITE_FACTORY_ADDRESS,
  VITE_FACTORY_DEPLOY_BLOCK: import.meta.env?.VITE_FACTORY_DEPLOY_BLOCK,
  VITE_REOWN_PROJECT_ID: import.meta.env?.VITE_REOWN_PROJECT_ID,
  VITE_CIRCLE_CLIENT_KEY: import.meta.env?.VITE_CIRCLE_CLIENT_KEY,
  VITE_CROSSCHAIN: import.meta.env?.VITE_CROSSCHAIN,
}

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
    irisUrl: 'https://iris-api.circle.com',
    modularChainPath: '/arc',
    cctpChains: [
      { key: 'Ethereum', chainId: 1, domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', viemChain: mainnet, rpcUrl: MAINNET_RPC_URL, fast: true, bridgeKitChain: 'Ethereum' },
      { key: 'Avalanche', chainId: 43114, domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', viemChain: avalanche, rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', fast: false, bridgeKitChain: 'Avalanche' },
      { key: 'Optimism', chainId: 10, domain: 2, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', viemChain: optimism, rpcUrl: 'https://mainnet.optimism.io', fast: true, bridgeKitChain: 'Optimism' },
      { key: 'Arbitrum', chainId: 42161, domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', viemChain: arbitrum, rpcUrl: 'https://arb1.arbitrum.io/rpc', fast: true, bridgeKitChain: 'Arbitrum' },
      { key: 'Base', chainId: 8453, domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', viemChain: base, rpcUrl: BASE_RPC_URL, fast: true, bridgeKitChain: 'Base' },
      { key: 'Polygon', chainId: 137, domain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', viemChain: polygon, rpcUrl: 'https://polygon.drpc.org', fast: false, bridgeKitChain: 'Polygon' },
    ],
    bridgeKitChain: 'Arc',
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
    irisUrl: 'https://iris-api-sandbox.circle.com',
    modularChainPath: '/arcTestnet',
    // Only the two source chains whose USDC was checked on-chain. Public RPCs as viem lists them.
    cctpChains: [
      { key: 'Ethereum', chainId: sepolia.id, domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', viemChain: sepolia, rpcUrl: sepolia.rpcUrls.default.http[0], fast: true, bridgeKitChain: 'Ethereum_Sepolia' },
      { key: 'Base', chainId: baseSepolia.id, domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', viemChain: baseSepolia, rpcUrl: baseSepolia.rpcUrls.default.http[0], fast: true, bridgeKitChain: 'Base_Sepolia' },
    ],
    bridgeKitChain: 'Arc_Testnet',
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

// The localStorage key for a fundit.<name> record on this network. Mainnet keeps the original names, so live
// sessions and pending records carry over. Testnet keys read fundit.testnet.<name>, so a dev origin rebuilt for
// the other network never sees the first network's session, backup flags or pending transfers.
export function storageKey(name: string, network: ArcNetwork = NETWORK.name): string {
  return network === 'mainnet' ? `fundit.${name}` : `fundit.${network}.${name}`
}

// Backstop for the build guard in deployConfig.ts: a testnet bundle never runs on fundit.fun.
if (typeof window !== 'undefined' && testnetRefusedOn(NETWORK.name, window.location.hostname)) {
  throw new Error('This is a test network build. It must not run on fundit.fun.')
}

// The order the source chains are named in copy.
const NAME_ORDER: readonly CctpChainKey[] = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche']

// "Ethereum, Base, ... or Avalanche": the source chains a network offers, by the names people know.
export function cctpChainNames(n: NetworkConfig): string {
  const keys = new Set(n.cctpChains.map((c) => c.key))
  return orList(NAME_ORDER.filter((k) => keys.has(k)).map((k) => n.chainLabels[k]))
}

export const ARC_CHAIN: Chain = NETWORK.chain
export const ARC_CHAIN_ID: number = NETWORK.chain.id
export const ARC_DOMAIN = NETWORK.domain
export const EXPLORER_URL: string = NETWORK.explorerUrl

// Amounts always use the ERC-20 interface (6 decimals), never the 18-decimal native balance.
export const TOKENS: Record<TokenSymbol, { address: Address; decimals: 6; symbol: TokenSymbol }> = {
  USDC: { address: NETWORK.usdc, decimals: 6, symbol: 'USDC' },
  EURC: { address: NETWORK.eurc, decimals: 6, symbol: 'EURC' },
}

export const TOKEN_MESSENGER_V2: Address = NETWORK.tokenMessengerV2

// Used as the wagmi transport for Arc. VITE_ARC_RPC_URL overrides it (a local node, for example).
export const ARC_RPC_URL: string = env.VITE_ARC_RPC_URL || NETWORK.rpcUrl
// Arc's public RPCs as the network's viem chain lists them, the fallbacks for Arc reads. Hosts under *.arc.io.
export const ARC_RPC_FALLBACKS: readonly string[] = NETWORK.chain.rpcUrls.default.http

export const CCTP_CHAINS: readonly CctpChain[] = NETWORK.cctpChains
export const CHAIN_LABELS: Record<'Arc' | CctpChainKey, string> = NETWORK.chainLabels
export const CHAIN_NAMES: string = cctpChainNames(NETWORK)

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
// Circle's weighted multisig plugin, which holds the owners of every Circle Modular Wallets account
// (CIRCLE_WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN in @circle-fin/modular-wallets-core dist/index.js). Same address on
// Arc mainnet and Arc testnet, checked on-chain.
export const CIRCLE_MULTISIG_PLUGIN: Address = '0x0000000C984AFf541D6cE86Bb697e68ec57873C8'
// Arc network fees are paid in USDC from the sender's own balance. A regular wallet adding USDC to a Fundit
// account keeps this much free. It is also the least a Fundit account ever keeps back (see passkeyReserve).
export const PASSKEY_GAS_BUFFER = 50_000n
// A Fundit account pays for a user operation by moving its prefund (all its gas limits times the max fee) into
// the EntryPoint before the calls run, so it keeps back more than the fee itself. passkeySender checks the
// exact prefund before every send. When an operation cannot be estimated, these gas units stand in, times
// Circle's fee at the time. Measured on Arc testnet on 2026-10-18 (all limits as sent): 254k to 425k for a
// send, gift or withdrawal from a deployed account, 795k to create a Fundit, and 1.53M for the first operation,
// which also deploys the account.
export const FALLBACK_GAS_DEPLOYED = 450_000n
export const FALLBACK_GAS_NEW_ACCOUNT = 1_600_000n
// Only when Circle's fee cannot be read either: the highest max fee seen from Circle on Arc testnet (about 900
// gwei, in native wei per gas). With FALLBACK_GAS_NEW_ACCOUNT and the margin that is 1.80 USDC.
export const WORST_SEEN_FEE = 900_000_000_000n
// ERC-4337 EntryPoint v0.7, used by Circle Modular Wallets. Same address on every chain. It holds each
// account's deposit: prefund left over from earlier operations, which pays for the next one first.
export const ENTRY_POINT: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
// Add money from another chain (bridging USDC into the Fundit account). Off by default. A transfer already saved
// in the browser is still tracked either way.
export const CROSSCHAIN_ENABLED: boolean = env.VITE_CROSSCHAIN === '1'

export const IRIS_URL: string = NETWORK.irisUrl
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
