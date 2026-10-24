import { type Address, isAddress, isAddressEqual } from 'viem'
import { storageKey } from '../config'
import { ACCOUNT_EVENT } from './account'
import { PlainError, WrongWalletAccount } from './errors'
import type { Sender } from './sender'

// The wallet account's store: the address and the wagmi connector it signed in with. Nothing in this file loads
// wagmi at start; the sender imports it on its first send.
export const WALLET_KEY = storageKey('session.wallet')

export type WalletSession = { address: Address; connectorId: string }

export const WALLET_LOCKED = 'Your wallet did not reconnect. Open it, unlock it if it asks, then try again.'

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_EVENT))
}

export function readWalletSession(): WalletSession | null {
  try {
    const x = JSON.parse(localStorage.getItem(WALLET_KEY) ?? 'null') as Partial<WalletSession> | null
    if (!x || typeof x.address !== 'string' || !isAddress(x.address) || typeof x.connectorId !== 'string' || x.connectorId === '') return null
    return { address: x.address, connectorId: x.connectorId }
  } catch {
    return null
  }
}

export function saveWalletSession(s: WalletSession) {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ address: s.address, connectorId: s.connectorId }))
  } catch {
    // Storage is unavailable. The person signs in again next time.
  }
  notify()
}

export function clearWalletSession() {
  try {
    localStorage.removeItem(WALLET_KEY)
  } catch {
    // Nothing stored to clear.
  }
  notify()
}

// The sender for a wallet account. After a reload the account shows from its store at once, but the wallet is
// not connected yet: the first send loads wagmi and reconnects the wallet the person signed in with. If the
// wallet comes back on another account, the session ends and nothing is sent. If it comes back with no account
// (a locked wallet, say), nothing is sent and the session stays, so a try after unlocking works.
export function walletAccountSender(s: WalletSession): Sender {
  return {
    kind: 'wallet',
    address: s.address,
    async send(calls, opts) {
      const [{ wagmiConfig }, { getAccount, reconnect }, { wagmiSender }] = await Promise.all([
        import('../wagmi'),
        import('@wagmi/core'),
        import('./wagmiSender'),
      ])
      const same = (now: Address | undefined) => now !== undefined && isAddressEqual(now, s.address)
      if (!same(getAccount(wagmiConfig).address)) {
        const connector = wagmiConfig.connectors.find((c) => c.id === s.connectorId)
        await reconnect(wagmiConfig, connector ? { connectors: [connector] } : undefined)
        const now = getAccount(wagmiConfig).address
        if (now === undefined) throw new PlainError(WALLET_LOCKED)
        if (!same(now)) {
          clearWalletSession()
          throw new WrongWalletAccount(s.address)
        }
      }
      return wagmiSender(wagmiConfig, s.address).send(calls, opts)
    },
  }
}
