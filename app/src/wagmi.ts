import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { http } from 'wagmi'
import { ARC_CHAIN, ARC_RPC_URL, CCTP_CHAINS, REOWN_PROJECT_ID } from './config'

// Arc first, then the network's CCTP source chains.
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [ARC_CHAIN, ...CCTP_CHAINS.map((c) => c.viemChain)]

// Our public RPCs first. AppKit adds its own RPC as a fallback on the chains it supports.
const transports = {
  [ARC_CHAIN.id]: http(ARC_RPC_URL),
  ...Object.fromEntries(CCTP_CHAINS.map((c) => [c.chainId, http(c.rpcUrl)])),
}

export const wagmiAdapter = new WagmiAdapter({ projectId: REOWN_PROJECT_ID, networks, transports })

export const wagmiConfig = wagmiAdapter.wagmiConfig

createAppKit({
  adapters: [wagmiAdapter],
  projectId: REOWN_PROJECT_ID,
  networks,
  defaultNetwork: ARC_CHAIN,
  metadata: {
    name: 'Fundit',
    description: 'Fundraising for everyone, everywhere. Each Fundit holds its money in its own on-chain escrow that only the organiser can withdraw.',
    // Wallets compare this with the page origin, so use the real one (fundit.fun in production).
    url: window.location.origin,
    icons: [`${window.location.origin}/images/web-app-manifest-192x192.png`],
  },
  // Email and socials are also turned off in the Reown dashboard, which overrides these flags.
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false },
  // Both open smart contract wallets on other networks. A wallet connects only to add money on Arc, and these
  // are kept off until one is checked on Arc.
  enableCoinbase: false,
  enableBaseAccount: false,
})
