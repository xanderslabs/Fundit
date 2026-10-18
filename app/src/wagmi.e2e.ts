import { type Address, isAddress } from 'viem'
import { createConfig, http, mock } from 'wagmi'
import { ARC_CHAIN, ARC_RPC_URL, CCTP_CHAINS } from './config'

// Test-only wagmi config, swapped in for ./wagmi by vite.config.ts in `--mode e2e`. No AppKit, no Reown.
// The mock connector forwards eth_sendTransaction to the chain's first RPC URL, so Arc points at the
// local fork (VITE_ARC_RPC_URL in .env.e2e). The fork's default accounts are unlocked and sign there.
const arcLocal = { ...ARC_CHAIN, rpcUrls: { default: { http: [ARC_RPC_URL] } } } as const

// Anvil default account 1. A test picks another unlocked account by setting this key before the page loads.
// defaultConnected plus reconnect lets a page reload keep the wallet connected after the first connect, as a real
// wallet does. Before that first connect the app shows "Sign in".
const DEFAULT_ACCOUNT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
export const E2E_ACCOUNT_KEY = 'fundit.e2e.account'

function testAccount(): Address {
  try {
    const stored = localStorage.getItem(E2E_ACCOUNT_KEY)
    if (stored && isAddress(stored)) return stored
  } catch {
    // Storage blocked: use the default account.
  }
  return DEFAULT_ACCOUNT
}

export const TEST_ACCOUNT: Address = testAccount()

export const wagmiConfig = createConfig({
  chains: [arcLocal, ...CCTP_CHAINS.map((c) => c.viemChain)],
  connectors: [mock({ accounts: [TEST_ACCOUNT], features: { defaultConnected: true, reconnect: true } })],
  transports: {
    [ARC_CHAIN.id]: http(ARC_RPC_URL),
    ...Object.fromEntries(CCTP_CHAINS.map((c) => [c.chainId, http(c.rpcUrl)])),
  },
})
