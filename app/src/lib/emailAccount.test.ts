import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../config'
import { EmailError, readEmailSession, readEmailTokens, saveEmailSession, saveEmailTokens, SIGN_IN_AGAIN, tagEmailTokens, ucw } from './emailAccount'

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

describe('ucw 401', () => {
  function answer401(body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 401, headers: { 'content-type': 'application/json' } })))
  }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Circle may answer an expired user token with HTTP 401 and code 155104. That token can be refreshed, so signing
  // the person out here would end every session at the token's lifetime instead of refreshing it.
  it('keeps the account signed in on a 401 with Circle code 155104, so the caller can refresh', async () => {
    saveEmailSession(X)
    answer401({ code: 155104, message: 'Token expired' })
    const err = await ucw('sign-transaction', { walletId: X.walletId }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EmailError)
    expect(err).toMatchObject({ status: 401, code: 155104 })
    expect(readEmailSession()).toEqual(X)
  })

  // The Worker's own 401 ("Not signed in") carries no Circle code: its cookies are gone, so nothing can refresh.
  it('signs out on a 401 without a Circle code', async () => {
    saveEmailSession(X)
    answer401({ error: 'Not signed in' })
    await expect(ucw('sign-transaction', { walletId: X.walletId })).rejects.toThrow(SIGN_IN_AGAIN)
    expect(readEmailSession()).toBeNull()
  })

  // The session route is the refresh itself. A 155104 there means the refresh failed, so the account goes.
  it('signs out on a 401 with 155104 from the session route', async () => {
    saveEmailSession(X)
    answer401({ code: 155104, message: 'Token expired' })
    await expect(ucw('session', { deviceId: 'd' })).rejects.toThrow(SIGN_IN_AGAIN)
    expect(readEmailSession()).toBeNull()
  })
})
