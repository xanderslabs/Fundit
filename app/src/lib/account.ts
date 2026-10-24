import { useMemo, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { clearEmailSession, EMAIL_KEY, readEmailSession } from './emailAccount'
import { clearWalletSession, readWalletSession, WALLET_KEY } from './walletAccount'

// The two ways to sign in. Each keeps its own small store; signing in with one clears the other.
export type AccountKind = 'email' | 'wallet'
export type Account = { kind: AccountKind; address: Address }

// Fired in this tab when the email or wallet store changes.
export const ACCOUNT_EVENT = 'fundit:account'

// useSyncExternalStore needs the same object back while nothing changed, so each parsed value is cached by its text.
// The key is read on each call: emailAccount.ts and walletAccount.ts import this module too, so their constants are
// not ready yet here.
function cached<T>(key: () => string, read: () => T | null) {
  let last: { raw: string | null; value: T | null } = { raw: null, value: null }
  return (): T | null => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key())
    } catch {
      return null
    }
    if (raw !== last.raw) last = { raw, value: read() }
    return last.value
  }
}
const emailSnapshot = cached(() => EMAIL_KEY, readEmailSession)
const walletSnapshot = cached(() => WALLET_KEY, readWalletSession)

function subscribe(onChange: () => void) {
  window.addEventListener(ACCOUNT_EVENT, onChange)
  // Another tab signed in or out.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(ACCOUNT_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

const none = () => null

// The signed-in account, or null. Email first if somehow both stores are set.
export function useAccount(): Account | null {
  const email = useSyncExternalStore(subscribe, emailSnapshot, none)
  const wallet = useSyncExternalStore(subscribe, walletSnapshot, none)
  return useMemo(() => {
    if (email) return { kind: 'email', address: email.address }
    if (wallet) return { kind: 'wallet', address: wallet.address }
    return null
  }, [email, wallet])
}

// Called right after a sign-in, so only the new account stays.
export function clearOtherSessions(keep: AccountKind) {
  if (keep !== 'email') clearEmailSession()
  if (keep !== 'wallet') clearWalletSession()
}

// The line under a send button: what the person confirms next, and where.
export function confirmLine(kind: AccountKind): string {
  return kind === 'email' ? 'Approve in the Circle window' : 'Confirm in your wallet'
}
