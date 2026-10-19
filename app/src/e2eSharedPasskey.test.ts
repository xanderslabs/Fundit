import { describe, expect, it } from 'vitest'
import { checkRpId, parseSharedPasskey, serializeSharedPasskey, signCountNow, topUpFor } from '../e2e/sharedPasskey'

// The e2e suite reuses one passkey account, so Circle's count of active wallets stays low. Its private key sits in
// a gitignored file and must never show up in an error message or a log.
const PASSKEY = {
  credentialId: 'Y3JlZC1pZC1mb3ItdGVzdHM=',
  privateKey: 'TUlHSEFnRUFNQk1HQnlxR1NNNDlBZ0VHQ0NxR1NNNDlBd0VIQkcwd2F3SUJBUVFn',
  rpId: 'fundit.fun',
  userHandle: 'dXNlci1oYW5kbGU=',
  account: '0x00000000000000000000000000000000000000cc',
  username: 'e2e-shared-1760000000000',
} as const

describe('shared e2e passkey file', () => {
  it('reads back what it writes', () => {
    expect(parseSharedPasskey(serializeSharedPasskey(PASSKEY))).toEqual(PASSKEY)
  })

  it('names a missing value without printing any value', () => {
    const text = serializeSharedPasskey(PASSKEY)
      .split('\n')
      .filter((l) => !l.startsWith('E2E_PASSKEY_USER_HANDLE='))
      .join('\n')
    expect(() => parseSharedPasskey(text)).toThrow(/E2E_PASSKEY_USER_HANDLE/)
    try {
      parseSharedPasskey(text)
    } catch (err) {
      expect(String(err)).not.toContain(PASSKEY.privateKey)
    }
  })

  it('refuses a private key that is not base64, without printing it', () => {
    const text = serializeSharedPasskey({ ...PASSKEY, privateKey: 'not base64 at all!' })
    expect(() => parseSharedPasskey(text)).toThrow(/E2E_PASSKEY_PRIVATE_KEY/)
    expect(() => parseSharedPasskey(text)).not.toThrow(/not base64 at all/)
  })
})

describe('checkRpId', () => {
  // A passkey works only on the site it was made for. Against localhost the browser would offer no passkey and
  // the run would fail late with a vague timeout, so it stops first and says why.
  it('accepts the site the passkey was made on', () => {
    expect(() => checkRpId(PASSKEY, 'https://fundit.fun')).not.toThrow()
  })

  it('refuses localhost with the reason', () => {
    expect(() => checkRpId(PASSKEY, 'http://localhost:5174')).toThrow(/bound to fundit\.fun.*E2E_BASE_URL=https:\/\/fundit\.fun/s)
  })
})

describe('topUpFor', () => {
  // The account keeps its money between runs, so the funder sends only the difference.
  it('sends only what is missing for the run', () => {
    expect(topUpFor(500_000n, 2_000_000n)).toBe(1_500_000n)
    expect(topUpFor(2_500_000n, 2_000_000n)).toBe(0n)
  })
})

describe('signCountNow', () => {
  // A stored passkey goes back into a fresh authenticator each run. The count must still go up from run to run.
  it('grows with time and fits in 32 bits', () => {
    const now = signCountNow()
    expect(now).toBeGreaterThan(1_700_000_000)
    expect(now).toBeLessThan(2 ** 32)
  })
})
