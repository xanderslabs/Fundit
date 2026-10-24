import { useMemo, useSyncExternalStore } from 'react'
import { type Address, isAddress } from 'viem'
import { storageKey } from '../config'
import { clearPasskeySession, usePasskeySession } from './passkey'
import { clearWalletSession, readWalletSession, WALLET_KEY } from './walletAccount'

// The three ways to sign in. Each keeps its own small store; signing in with one clears the other two.
export type AccountKind = 'passkey' | 'email' | 'wallet'
export type Account = { kind: AccountKind; address: Address }

// Fired in this tab when the email or wallet store changes. The passkey store has its own event (PASSKEY_EVENT).
export const ACCOUNT_EVENT = 'fundit:account'

function notifyAccount() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_EVENT))
}

// The email account's store. The Circle tokens are never in it.
export const EMAIL_KEY = storageKey('session.email')
export type EmailSession = { address: Address; walletId: string; email: string }

export function readEmailSession(): EmailSession | null {
  try {
    const x = JSON.parse(localStorage.getItem(EMAIL_KEY) ?? 'null') as Partial<EmailSession> | null
    if (!x || typeof x.address !== 'string' || !isAddress(x.address) || typeof x.walletId !== 'string' || typeof x.email !== 'string') return null
    return { address: x.address, walletId: x.walletId, email: x.email }
  } catch {
    return null
  }
}

export function clearEmailSession() {
  try {
    localStorage.removeItem(EMAIL_KEY)
  } catch {
    // Nothing stored to clear.
  }
  notifyAccount()
}

// useSyncExternalStore needs the same object back while nothing changed, so each parsed value is cached by its text.
// The key is read on each call: walletAccount.ts imports this module too, so its constants are not ready yet here.
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

// The signed-in account, or null. Passkey first if somehow more than one store is set.
export function useAccount(): Account | null {
  const passkey = usePasskeySession()
  const email = useSyncExternalStore(subscribe, emailSnapshot, none)
  const wallet = useSyncExternalStore(subscribe, walletSnapshot, none)
  return useMemo(() => {
    if (passkey) return { kind: 'passkey', address: passkey.address }
    if (email) return { kind: 'email', address: email.address }
    if (wallet) return { kind: 'wallet', address: wallet.address }
    return null
  }, [passkey, email, wallet])
}

// Called right after a sign-in, so only the new account stays.
export function clearOtherSessions(keep: AccountKind) {
  if (keep !== 'passkey') clearPasskeySession()
  if (keep !== 'email') clearEmailSession()
  if (keep !== 'wallet') clearWalletSession()
}

// The line under a send button: what the person confirms next, and where.
export function confirmLine(kind: AccountKind): string {
  if (kind === 'email') return 'Approve in the Circle window'
  if (kind === 'wallet') return 'Confirm in your wallet'
  return 'Confirm with your passkey'
}
