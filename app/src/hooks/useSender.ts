import { useMemo } from 'react'
import { storedPasskeySender, usePasskeySession } from '../lib/passkey'
import type { Sender } from '../lib/sender'

// The Sender for the signed-in Fundit account, or null when signed out. Sign-in is passkey only: a wallet
// connected to add money never acts for the person anywhere else.
export function useSender(): Sender | null {
  const passkey = usePasskeySession()
  return useMemo(() => (passkey ? storedPasskeySender(passkey) : null), [passkey])
}
