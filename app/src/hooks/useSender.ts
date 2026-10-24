import { useMemo } from 'react'
import { useAccount } from '../lib/account'
import { readEmailSession } from '../lib/emailAccount'
import { emailSender } from '../lib/emailSender'
import { storedPasskeySender, usePasskeySession } from '../lib/passkey'
import type { Sender } from '../lib/sender'
import { readWalletSession, walletAccountSender } from '../lib/walletAccount'

// The Sender for the signed-in Fundit account, or null when signed out.
// The kind is passkey, email or wallet. A wallet connected only to add money never acts for the person anywhere else.
export function useSender(): Sender | null {
  const account = useAccount()
  const passkey = usePasskeySession()
  return useMemo(() => {
    if (account?.kind === 'passkey' && passkey) return storedPasskeySender(passkey)
    if (account?.kind === 'email') {
      const email = readEmailSession()
      return email ? emailSender(email) : null
    }
    if (account?.kind === 'wallet') {
      const wallet = readWalletSession()
      return wallet ? walletAccountSender(wallet) : null
    }
    return null
  }, [account, passkey])
}
