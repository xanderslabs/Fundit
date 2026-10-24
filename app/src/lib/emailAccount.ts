import { type Address, isAddress } from 'viem'
import { storageKey } from '../config'
import { ACCOUNT_EVENT } from './account'
import { PlainError } from './errors'

// The email account's store and its calls to the Worker (/api/ucw/*). Nothing here loads Circle's SDK.
//
// The store holds only { address, walletId, email }. Circle's userToken and encryptionKey, which Circle's window
// needs to run a challenge, live in memory and sessionStorage for this tab. Never in localStorage, and never logged.
export const EMAIL_KEY = storageKey('session.email')
const TOKENS_KEY = storageKey('session.email.tokens')

export type EmailSession = { address: Address; walletId: string; email: string }
export type EmailTokens = { userToken: string; encryptionKey: string }

// Circle's code for an expired user token (CIRCLE_CODE.userTokenExpired in circleEmail.ts, which loads the SDK).
const CIRCLE_TOKEN_EXPIRED = 155104

// When Circle's tokens for this browser can no longer be refreshed.
export const SIGN_IN_AGAIN = 'Sign in again to continue'

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_EVENT))
}

export function readEmailSession(): EmailSession | null {
  try {
    const x = JSON.parse(localStorage.getItem(EMAIL_KEY) ?? 'null') as Partial<EmailSession> | null
    if (!x || typeof x.address !== 'string' || !isAddress(x.address) || typeof x.walletId !== 'string' || typeof x.email !== 'string') return null
    return { address: x.address, walletId: x.walletId, email: x.email }
  } catch {
    return null
  }
}

export function saveEmailSession(s: EmailSession) {
  try {
    localStorage.setItem(EMAIL_KEY, JSON.stringify({ address: s.address, walletId: s.walletId, email: s.email }))
  } catch {
    // Storage is unavailable. The person signs in again next time.
  }
  notify()
}

// Ends the email account in this browser, with its tokens. The Worker's cookies go with signOutEmail().
export function clearEmailSession() {
  try {
    localStorage.removeItem(EMAIL_KEY)
  } catch {
    // Nothing stored to clear.
  }
  clearEmailTokens()
  notify()
}

// The tokens belong to one wallet: walletId is the email account they were issued for, or null between the code
// and the end of openEmailAccount, before the wallet is known. Tokens for any other account are never used.
type Cached = { tokens: EmailTokens; walletId: string | null }
let memory: Cached | null = null

function owner(): string | null {
  return readEmailSession()?.walletId ?? null
}

function cachedTokens(): Cached | null {
  if (memory) return memory
  try {
    const x = JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? 'null') as (Partial<EmailTokens> & { walletId?: unknown }) | null
    if (x && typeof x.userToken === 'string' && typeof x.encryptionKey === 'string' && (typeof x.walletId === 'string' || x.walletId === null)) {
      memory = { tokens: { userToken: x.userToken, encryptionKey: x.encryptionKey }, walletId: x.walletId }
    }
  } catch {
    // Nothing usable stored. The Worker can refresh from its cookies.
  }
  return memory
}

// This tab's tokens for the signed-in email account, or null (the Worker can refresh them from its cookies).
export function readEmailTokens(): EmailTokens | null {
  const c = cachedTokens()
  return c && c.walletId === owner() ? c.tokens : null
}

export function saveEmailTokens(t: EmailTokens, walletId: string | null = owner()) {
  memory = { tokens: { userToken: t.userToken, encryptionKey: t.encryptionKey }, walletId }
  try {
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify({ ...memory.tokens, walletId }))
  } catch {
    // Memory only: a reload refreshes through the Worker.
  }
}

// Ties the tokens from a login to the wallet it opened (openEmailAccount).
export function tagEmailTokens(walletId: string) {
  const c = cachedTokens()
  if (c) saveEmailTokens(c.tokens, walletId)
}

export function clearEmailTokens() {
  memory = null
  try {
    sessionStorage.removeItem(TOKENS_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

// Another tab signed out, switched account or cleared storage. This tab's tokens may now belong to someone else,
// so they go; the next challenge gets fresh ones from the Worker for whoever is signed in.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === EMAIL_KEY || e.key === null) clearEmailTokens()
  })
}

// A failed Worker or Circle call. status is the HTTP status (0 when the Worker never answered, null for an error
// from Circle's SDK). code is Circle's error code, such as 155104 or 155133, when Circle gave one.
export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null,
  ) {
    super(message)
  }
}

// POST /api/ucw/<route> on this site. The Worker adds Circle's user token from its HttpOnly cookie, so no body
// here carries a token except /login's. Resolves to the JSON answer; throws EmailError for anything else.
// A 401 means the Worker has no session for this browser (cookies expired or cleared, or a refresh refused): the
// email account cannot be restored, so it is signed out here and the person is asked to sign in again.
// A 401 that carries Circle's 155104 (user token expired) is not that: outside the session route the caller
// refreshes once and tries again, so it is thrown as an EmailError and the account stays signed in.
export async function ucw<T = Record<string, unknown>>(route: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/ucw/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (err) {
    throw new EmailError(err instanceof Error ? err.message : 'Worker unreachable', 0, null)
  }
  const out = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const code = typeof out?.code === 'number' ? out.code : null
  if (res.status === 401 && !(route !== 'session' && code === CIRCLE_TOKEN_EXPIRED)) {
    clearEmailSession()
    throw new PlainError(SIGN_IN_AGAIN)
  }
  if (!res.ok) {
    const message = typeof out?.message === 'string' ? out.message : typeof out?.error === 'string' ? out.error : `HTTP ${res.status}`
    throw new EmailError(message, res.status, code)
  }
  return (out ?? {}) as T
}
