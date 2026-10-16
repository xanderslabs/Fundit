import { useMemo } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { type Sender, wagmiSender } from '../lib/sender'

// The Sender for the connected wallet, or null when none is connected.
export function useSender(): Sender | null {
  const config = useConfig()
  const { address, isConnected } = useConnection()
  return useMemo(() => (isConnected && address ? wagmiSender(config, address) : null), [config, address, isConnected])
}
