import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { http } from 'wagmi'
import { arbitrum, arc, avalanche, base, mainnet, optimism, polygon } from 'viem/chains'
import { ARC_RPC_URL, CCTP_CHAINS, REOWN_PROJECT_ID } from './config'

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [arc, mainnet, base, arbitrum, optimism, polygon, avalanche]

// Our public RPCs first. AppKit adds its own RPC as a fallback on the chains it supports.
const transports = {
  [arc.id]: http(ARC_RPC_URL),
  ...Object.fromEntries(CCTP_CHAINS.map((c) => [c.chainId, http(c.rpcUrl)])),
}

export const wagmiAdapter = new WagmiAdapter({ projectId: REOWN_PROJECT_ID, networks, transports })

export const wagmiConfig = wagmiAdapter.wagmiConfig

createAppKit({
  adapters: [wagmiAdapter],
  projectId: REOWN_PROJECT_ID,
  networks,
  defaultNetwork: arc,
  metadata: {
    name: 'Fundit',
    description: 'Crowdfunding on Arc. Funds stay in an on-chain escrow that only the creator can withdraw.',
    // Wallets compare this with the page origin, so use the real one (fundit.xyz in production).
    url: window.location.origin,
    icons: [`${window.location.origin}/images/web-app-manifest-192x192.png`],
  },
  // Email and socials are also turned off in the Reown dashboard, which overrides these flags.
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false },
  // Both open smart contract wallets. Arc Memo reverts for a caller with code, so they are not offered.
  enableCoinbase: false,
  enableBaseAccount: false,
})
