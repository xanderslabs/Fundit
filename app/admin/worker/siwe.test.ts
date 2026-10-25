// @vitest-environment node
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage, type SiweMessage } from 'viem/siwe'
import { describe, expect, it } from 'vitest'
import { ADMIN_STATEMENT, checkLoginMessage, MAX_MESSAGE_CHARS, signerMatches } from './siwe'

const ORIGIN = 'https://admin.fundit.fun'
const CHAIN_ID = 5042002
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const owner = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const expect_ = { origin: ORIGIN, chainId: CHAIN_ID, nowMs: NOW }

// The message the panel builds, with fields a test overrides.
function message(over: Partial<SiweMessage> = {}): string {
  return createSiweMessage({
    address: owner.address,
    domain: 'admin.fundit.fun',
    uri: ORIGIN,
    version: '1',
    statement: ADMIN_STATEMENT,
    chainId: CHAIN_ID,
    nonce: 'abcdef0123456789',
    issuedAt: new Date(NOW),
    expirationTime: new Date(NOW + 5 * 60_000),
    ...over,
  })
}

describe('checkLoginMessage', () => {
  it('accepts the exact message the panel builds', () => {
    expect(checkLoginMessage(message(), expect_)).toEqual({ ok: true, address: owner.address, nonce: 'abcdef0123456789' })
  })

  // A signature made for the public site or a look-alike host must not open the panel.
  it('refuses another domain', () => {
    expect(checkLoginMessage(message({ domain: 'fundit.fun' }), expect_)).toEqual({ ok: false, reason: 'wrong_domain' })
    expect(checkLoginMessage(message({ domain: 'evil.admin.fundit.fun' }), expect_)).toEqual({ ok: false, reason: 'wrong_domain' })
    expect(checkLoginMessage(message({ scheme: 'http' }), expect_)).toEqual({ ok: false, reason: 'wrong_domain' })
  })

  it('refuses another uri', () => {
    expect(checkLoginMessage(message({ uri: 'https://fundit.fun' }), expect_)).toEqual({ ok: false, reason: 'wrong_uri' })
    expect(checkLoginMessage(message({ uri: `${ORIGIN}/other` }), expect_)).toEqual({ ok: false, reason: 'wrong_uri' })
  })

  // A mainnet sign-in must not work on the testnet Worker, or the other way round.
  it('refuses another chain id', () => {
    expect(checkLoginMessage(message({ chainId: 5042 }), expect_)).toEqual({ ok: false, reason: 'wrong_chain' })
  })

  it('refuses an expired message', () => {
    const old = message({ issuedAt: new Date(NOW - 9 * 60_000), expirationTime: new Date(NOW - 1) })
    expect(checkLoginMessage(old, expect_)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses a message that lives more than 10 minutes', () => {
    expect(checkLoginMessage(message({ expirationTime: new Date(NOW + 10 * 60_000 + 1) }), expect_)).toEqual({ ok: false, reason: 'too_long_lived' })
    // No expiration at all is refused too.
    expect(checkLoginMessage(message({ expirationTime: undefined }), expect_)).toEqual({ ok: false, reason: 'bad_message' })
  })

  it('refuses an issuedAt more than 60 seconds ahead', () => {
    const ahead = message({ issuedAt: new Date(NOW + 61_000), expirationTime: new Date(NOW + 5 * 60_000) })
    expect(checkLoginMessage(ahead, expect_)).toEqual({ ok: false, reason: 'not_yet_valid' })
    const skewed = message({ issuedAt: new Date(NOW + 59_000), expirationTime: new Date(NOW + 5 * 60_000) })
    expect(checkLoginMessage(skewed, expect_).ok).toBe(true)
  })

  it('refuses a notBefore in the future', () => {
    expect(checkLoginMessage(message({ notBefore: new Date(NOW + 2 * 60_000) }), expect_)).toEqual({ ok: false, reason: 'not_yet_valid' })
  })

  it('refuses another statement or version', () => {
    expect(checkLoginMessage(message({ statement: 'Sign in to Fundit.' }), expect_)).toEqual({ ok: false, reason: 'bad_message' })
    expect(checkLoginMessage(message({ statement: undefined }), expect_)).toEqual({ ok: false, reason: 'bad_message' })
    expect(checkLoginMessage(message().replace('Version: 1', 'Version: 2'), expect_)).toEqual({ ok: false, reason: 'bad_message' })
  })

  it('refuses a message over 2,048 characters', () => {
    const long = message({ resources: [`https://admin.fundit.fun/${'a'.repeat(MAX_MESSAGE_CHARS)}`] })
    expect(long.length).toBeGreaterThan(MAX_MESSAGE_CHARS)
    expect(checkLoginMessage(long, expect_)).toEqual({ ok: false, reason: 'bad_message' })
  })

  // parseSiweMessage does not anchor its second half, so text slipped in before "URI:" must not pass.
  it('refuses a message with extra lines or a lower case address', () => {
    const extra = message().replace('\nURI:', '\nURI: https://evil.example\nURI:')
    expect(checkLoginMessage(extra, expect_)).toEqual({ ok: false, reason: 'bad_message' })
    const lower = message().replace(owner.address, owner.address.toLowerCase())
    expect(checkLoginMessage(lower, expect_)).toEqual({ ok: false, reason: 'bad_message' })
    expect(checkLoginMessage('hello', expect_)).toEqual({ ok: false, reason: 'bad_message' })
  })
})

describe('signerMatches', () => {
  it('is true for the address that signed', async () => {
    const m = message()
    expect(await signerMatches(m, owner.address, await owner.signMessage({ message: m }))).toBe(true)
  })

  it('signerMatches is false for a signature by another key', async () => {
    const m = message()
    expect(await signerMatches(m, owner.address, await stranger.signMessage({ message: m }))).toBe(false)
    expect(await signerMatches(m, owner.address, '0x1234')).toBe(false)
  })
})
