import { afterEach, describe, expect, it } from 'vitest'
import { storageKey } from '../config'
import { readEmailTokens, saveEmailSession, saveEmailTokens, tagEmailTokens } from './emailAccount'

const X = { address: '0x00000000000000000000000000000000000000aa', walletId: 'wallet-x', email: 'x@example.com' } as const
const Y = { address: '0x00000000000000000000000000000000000000bb', walletId: 'wallet-y', email: 'y@example.com' } as const
const TOKENS_X = { userToken: 'user-token-x'.padEnd(30, 'x'), encryptionKey: 'enc-key-x'.padEnd(30, 'x') }

// What the browser fires in this tab when another tab changes localStorage.
function otherTab(key: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  otherTab(null, null)
})

describe('email tokens', () => {
  // Circle's tokens for one person must never run a challenge for another. A sign-out or a new sign-in in another
  // tab leaves this tab's copy behind unless it is dropped.
  it('drops cached tokens when another tab signs out or switches account', () => {
    saveEmailSession(X)
    saveEmailTokens(TOKENS_X)
    expect(readEmailTokens()).toEqual(TOKENS_X)

    // Another tab signed out.
    localStorage.removeItem(storageKey('session.email'))
    otherTab(storageKey('session.email'), null)
    saveEmailSession(X)
    expect(readEmailTokens()).toBeNull()
    expect(sessionStorage.length).toBe(0)

    // Another tab signed in as Y.
    saveEmailTokens(TOKENS_X)
    localStorage.setItem(storageKey('session.email'), JSON.stringify(Y))
    otherTab(storageKey('session.email'), JSON.stringify(Y))
    expect(readEmailTokens()).toBeNull()

    // Even without the event (a missed one), tokens tagged for X are not handed out while Y is signed in.
    saveEmailSession(X)
    saveEmailTokens(TOKENS_X)
    saveEmailSession(Y)
    expect(readEmailTokens()).toBeNull()
  })

  // During sign-in the wallet is not known yet; the tokens from the code serve the create step, then get its id.
  it('login tokens serve the create step, then belong to the wallet that opened', () => {
    saveEmailTokens(TOKENS_X, null)
    expect(readEmailTokens()).toEqual(TOKENS_X)
    tagEmailTokens(X.walletId)
    saveEmailSession(X)
    expect(readEmailTokens()).toEqual(TOKENS_X)
  })
})
