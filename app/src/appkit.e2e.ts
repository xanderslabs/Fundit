import { connect } from '@wagmi/core'
import { useConnection } from 'wagmi'
import { wagmiConfig } from './wagmi.e2e'

// Test-only stand-in for the two @reown/appkit/react hooks the app uses, swapped in by vite.config.ts in
// `--mode e2e`. open() connects the mock connector instead of showing the AppKit modal.
export function useAppKit() {
  return {
    open: async () => {
      await connect(wagmiConfig, { connector: wagmiConfig.connectors[0]! })
    },
  }
}

export function useAppKitAccount() {
  const { address, isConnected } = useConnection()
  return { address, isConnected }
}

// The modal never shows in e2e: open() connects straight away.
export function useAppKitState() {
  return { open: false }
}
