import { type Config, signMessage } from '@wagmi/core'
import { type Address, getAddress } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { ARC_CHAIN_ID } from '../../../src/config'
import { CANCELLED, isUserRejection } from '../../../src/lib/errors'
import { ADMIN_STATEMENT } from '../../worker/siwe'

const FALLBACK = "Couldn't sign in. Try again."
const EXPIRED = 'The sign-in request expired. Try again.'

// What the Worker's error codes (worker/index.ts) say to the person.
export const LOGIN_TEXT: Record<string, string> = {
  not_owner: 'This wallet is not the Fundit owner.',
  nonce: EXPIRED,
  expired: EXPIRED,
  rate_limited: 'Too many tries. Wait a minute and try again.',
  turnstile: "We couldn't confirm you're not a bot. Try again.",
  wrong_chain: 'This panel was built for another network.',
  wrong_domain: 'Open the admin panel at admin.fundit.fun and try again.',
  unavailable: "The admin service can't check the owner right now. Try again in a minute.",
}

type Failure = { ok: false; text: string }

async function post(path: string, body: unknown): Promise<{ ok: true; data: unknown } | Failure> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (res.ok) return { ok: true, data: await res.json() }
  const code = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error
  return { ok: false, text: (typeof code === 'string' && Object.hasOwn(LOGIN_TEXT, code) && LOGIN_TEXT[code]) || FALLBACK }
}

// The owner signs in with a message the Worker issued a nonce for: nonce (with the Turnstile token), the wallet
// signs, then login. The message is built by createSiweMessage because the Worker accepts nothing else.
export async function signIn(config: Config, address: Address, turnstileToken: string): Promise<{ ok: true } | Failure> {
  try {
    const nonce = await post('/api/admin/nonce', { turnstile: turnstileToken })
    if (!nonce.ok) return nonce
    const { nonce: value, issuedAt, expirationTime } = nonce.data as { nonce: string; issuedAt: string; expirationTime: string }
    const message = createSiweMessage({
      address: getAddress(address),
      chainId: ARC_CHAIN_ID,
      domain: location.host,
      uri: location.origin,
      version: '1',
      statement: ADMIN_STATEMENT,
      nonce: value,
      issuedAt: new Date(issuedAt),
      expirationTime: new Date(expirationTime),
    })
    let signature: string
    try {
      signature = await signMessage(config, { account: address, message })
    } catch (err) {
      if (isUserRejection(err)) return { ok: false, text: CANCELLED }
      throw err
    }
    const login = await post('/api/admin/login', { message, signature })
    return login.ok ? { ok: true } : login
  } catch {
    return { ok: false, text: FALLBACK }
  }
}
