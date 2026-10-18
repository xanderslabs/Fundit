import { connect } from '@wagmi/core'
import { wagmiConfig } from './wagmi.e2e'

// Test-only stand-in for useAppKit, the one @reown/appkit/react hook the app uses (only in Add money). It is
// swapped in by vite.config.ts in `--mode e2e`. open() connects the mock connector instead of showing the AppKit modal.
export function useAppKit() {
  return {
    open: async () => {
      await connect(wagmiConfig, { connector: wagmiConfig.connectors[0]! })
    },
  }
}
