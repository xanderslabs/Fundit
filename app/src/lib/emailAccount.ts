import { type Address, isAddress } from 'viem'
import { storageKey } from '../config'
import { ACCOUNT_EVENT } from './account'

// The email account's store and its calls to the Worker (/api/ucw/*). Nothing here loads Circle's SDK.
//
// The store holds only { address, walletId, email }. Circle's userToken and encryptionKey, which Circle's window
// needs to run a challenge, live in memory and sessionStorage for this tab. Never in localStorage, and never logged.
export const EMAIL_KEY = storageKey('session.email')
const TOKENS_KEY = storageKey('session.email.tokens')

export type EmailSession = { address: Address; walletId: string; email: string }
export type EmailTokens = { userToken: string; encryptionKey: string }

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

let memory: EmailTokens | null = null

export function readEmailTokens(): EmailTokens | null {
  if (memory) return memory
  try {
    const x = JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? 'null') as Partial<EmailTokens> | null
    if (x && typeof x.userToken === 'string' && typeof x.encryptionKey === 'string') memory = { userToken: x.userToken, encryptionKey: x.encryptionKey }
  } catch {
    // Nothing usable stored. The Worker can refresh from its cookies.
  }
  return memory
}

export function saveEmailTokens(t: EmailTokens) {
  memory = { userToken: t.userToken, encryptionKey: t.encryptionKey }
  try {
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(memory))
  } catch {
    // Memory only: a reload refreshes through the Worker.
  }
}

export function clearEmailTokens() {
  memory = null
  try {
    sessionStorage.removeItem(TOKENS_KEY)
  } catch {
    // Nothing stored to clear.
  }
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
export async function ucw<T = Record<string, unknown>>(route: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/ucw/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (err) {
    throw new EmailError(err instanceof Error ? err.message : 'Worker unreachable', 0, null)
  }
  const out = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const code = typeof out?.code === 'number' ? out.code : null
    const message = typeof out?.message === 'string' ? out.message : typeof out?.error === 'string' ? out.error : `HTTP ${res.status}`
    throw new EmailError(message, res.status, code)
  }
  return (out ?? {}) as T
}
