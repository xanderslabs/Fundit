import type { Config } from '@wagmi/core'
import { parseSiweMessage } from 'viem/siwe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARC_CHAIN_ID } from '../../../src/config'
import { CANCELLED } from '../../../src/lib/errors'
import { ADMIN_STATEMENT } from '../../worker/siwe'
import { LOGIN_TEXT, signIn } from './siweLogin'

const core = vi.hoisted(() => ({ signMessage: vi.fn() }))
vi.mock('@wagmi/core', () => ({ signMessage: core.signMessage }))

const CONFIG = {} as Config
// Lower case on purpose: the server wants the checksummed form, so signIn must convert it.
const ADDRESS = '0x3552e9c14c7b6050839009a5b160a4446a1e916d' as const
const NONCE = { nonce: 'a'.repeat(64), issuedAt: '2026-10-25T10:00:00.000Z', expirationTime: '2026-10-25T10:10:00.000Z' }
const SIGNATURE = '0xabc123'

const fetchMock = vi.fn()
let replies: Array<{ status: number; body: unknown }>
beforeEach(() => {
  replies = [
    { status: 200, body: NONCE },
    { status: 200, body: { address: ADDRESS } },
  ]
  fetchMock.mockImplementation(async () => {
    const r = replies.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  })
  core.signMessage.mockResolvedValue(SIGNATURE)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const signed = () => core.signMessage.mock.calls[0]![1] as { account: string; message: string }

describe('signIn', () => {
  it('signs a message with the server nonce, issuedAt and expirationTime', async () => {
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: true })
    const m = parseSiweMessage(signed().message)
    expect(m.nonce).toBe(NONCE.nonce)
    expect(m.issuedAt?.toISOString()).toBe(NONCE.issuedAt)
    expect(m.expirationTime?.toISOString()).toBe(NONCE.expirationTime)
    expect(m.statement).toBe(ADMIN_STATEMENT)
    // The server refuses a message that is not byte for byte what createSiweMessage gives, which needs EIP-55.
    expect(m.address).toBe('0x3552E9c14C7b6050839009A5B160A4446a1e916D')
    const login = fetchMock.mock.calls[1]!
    expect(login[0]).toBe('/api/admin/login')
    expect(JSON.parse(login[1].body)).toEqual({ message: signed().message, signature: SIGNATURE })
  })

  it('uses location.host as domain, location.origin as uri and ARC_CHAIN_ID', async () => {
    await signIn(CONFIG, ADDRESS, 'tok')
    const m = parseSiweMessage(signed().message)
    expect(m.domain).toBe(location.host)
    expect(m.uri).toBe(location.origin)
    expect(m.chainId).toBe(ARC_CHAIN_ID)
  })

  it('sends the Turnstile token with the nonce request', async () => {
    await signIn(CONFIG, ADDRESS, 'tok-123')
    const nonce = fetchMock.mock.calls[0]!
    expect(nonce[0]).toBe('/api/admin/nonce')
    expect(nonce[1].method).toBe('POST')
    expect(JSON.parse(nonce[1].body)).toEqual({ turnstile: 'tok-123' })
  })

  it.each([
    ['not_owner', 'This wallet is not the Fundit owner.'],
    ['nonce', 'The sign-in request expired. Try again.'],
    ['expired', 'The sign-in request expired. Try again.'],
    ['rate_limited', 'Too many tries. Wait a minute and try again.'],
    ['turnstile', "We couldn't confirm you're not a bot. Try again."],
    ['wrong_chain', 'This panel was built for another network.'],
    ['wrong_domain', 'Open the admin panel at admin.fundit.fun and try again.'],
    ['unavailable', "The admin service can't check the owner right now. Try again in a minute."],
  ])('maps %s to its text', async (code, text) => {
    expect(LOGIN_TEXT[code]).toBe(text)
    replies = [
      { status: 200, body: NONCE },
      { status: 403, body: { error: code } },
    ]
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: false, text })
    // The same codes at the nonce step (the Turnstile and rate limit checks happen there).
    replies = [{ status: 403, body: { error: code } }]
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: false, text })
  })

  it('falls back to a plain text for an unknown code or no answer', async () => {
    replies = [{ status: 503, body: { error: 'something_new' } }]
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: false, text: "Couldn't sign in. Try again." })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: false, text: "Couldn't sign in. Try again." })
  })

  it('a wallet cancel returns CANCELLED', async () => {
    core.signMessage.mockRejectedValue(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
    expect(await signIn(CONFIG, ADDRESS, 'tok')).toEqual({ ok: false, text: CANCELLED })
    // Nothing is posted to /login after a cancel.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
