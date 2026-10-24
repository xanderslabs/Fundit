import { useMemo } from 'react'
import { useAccount } from '../lib/account'
import { readEmailSession } from '../lib/emailAccount'
import { emailSender } from '../lib/emailSender'
import type { Sender } from '../lib/sender'
import { readWalletSession, walletAccountSender } from '../lib/walletAccount'

// The Sender for the signed-in Fundit account, or null when signed out.
// The kind is email or wallet. A wallet connected only to add money never acts for the person anywhere else.
export function useSender(): Sender | null {
  const account = useAccount()
  return useMemo(() => {
    if (account?.kind === 'email') {
      const email = readEmailSession()
      return email ? emailSender(email) : null
    }
    if (account?.kind === 'wallet') {
      const wallet = readWalletSession()
      return wallet ? walletAccountSender(wallet) : null
    }
    return null
  }, [account])
}
