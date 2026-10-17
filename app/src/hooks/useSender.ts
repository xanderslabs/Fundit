import { useMemo, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { useConfig, useConnection } from 'wagmi'
import { type StoredPasskey, storedPasskeySender, usePasskeySession } from '../lib/passkey'
import { type Sender, wagmiSender } from '../lib/sender'

// Which wallet acts when a passkey session and a connected wallet are both active. An external wallet can stay
// connected next to a passkey session, to bridge USDC into it. Kept for this page load only; the passkey is
// the default.
export type ActiveWallet = 'passkey' | 'external'

let preferred: ActiveWallet = 'passkey'
const listeners = new Set<() => void>()

export function setActiveWallet(next: ActiveWallet) {
  if (next === preferred) return
  preferred = next
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

const getPreferred = () => preferred

// The preference counts only when both exist. Otherwise whichever exists acts.
export function pickWallet(o: { passkey: StoredPasskey | null; external: Address | null; prefer: ActiveWallet }): ActiveWallet | null {
  if (o.passkey && o.external) return o.prefer
  if (o.passkey) return 'passkey'
  if (o.external) return 'external'
  return null
}

export type WalletChoice = {
  // A passkey session and a connected wallet are both active, so the person can choose.
  both: boolean
  active: ActiveWallet | null
  // The connected wallet's address, if one is connected.
  external: Address | null
  setActive: (next: ActiveWallet) => void
}

export function useWalletChoice(): WalletChoice {
  const { address, isConnected } = useConnection()
  const passkey = usePasskeySession()
  const prefer = useSyncExternalStore(subscribe, getPreferred, getPreferred)
  const external = isConnected && address ? address : null
  return {
    both: passkey !== null && external !== null,
    active: pickWallet({ passkey, external, prefer }),
    external,
    setActive: setActiveWallet,
  }
}

// The Sender for whoever acts: the wallet pickWallet chooses, or null.
export function useSender(): Sender | null {
  const config = useConfig()
  const { address, isConnected } = useConnection()
  const passkey = usePasskeySession()
  const prefer = useSyncExternalStore(subscribe, getPreferred, getPreferred)
  return useMemo(() => {
    const external = isConnected && address ? address : null
    const active = pickWallet({ passkey, external, prefer })
    if (active === 'passkey') return storedPasskeySender(passkey!)
    return active === 'external' ? wagmiSender(config, external!) : null
  }, [config, address, isConnected, passkey, prefer])
}
