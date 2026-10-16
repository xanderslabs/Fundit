import { useMemo } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { storedPasskeySender, usePasskeySession } from '../lib/passkey'
import { type Sender, wagmiSender } from '../lib/sender'

// The Sender for whoever acts: a logged-in passkey wallet first, then the connected wallet, or null.
// An external wallet can stay connected next to a passkey session, to bridge USDC into it.
export function useSender(): Sender | null {
  const config = useConfig()
  const { address, isConnected } = useConnection()
  const passkey = usePasskeySession()
  return useMemo(() => {
    if (passkey) return storedPasskeySender(passkey)
    return isConnected && address ? wagmiSender(config, address) : null
  }, [config, address, isConnected, passkey])
}
