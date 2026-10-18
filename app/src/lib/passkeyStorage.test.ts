import { getAddress } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = getAddress('0x00000000000000000000000000000000000000cc')

// One dev origin can be rebuilt for the other network. A testnet build must not pick up the mainnet session, a
// mainnet "recovery key saved" flag or a mainnet pending backup for the same address, nor overwrite them.
// This file has no config mock: vi.resetModules does not reset mocked modules, and the test needs the real config
// to load again with VITE_ARC_NETWORK=testnet.
describe('storage on testnet', () => {
  const addr = '0x00000000000000000000000000000000000000cc'
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps testnet records apart from mainnet ones', async () => {
    localStorage.setItem('fundit.passkey', JSON.stringify({ address: ACCOUNT, credentialId: 'cred-mainnet' }))
    localStorage.setItem(`fundit.backup.${addr}`, '1')
    localStorage.setItem(`fundit.backup.pending.${addr}`, JSON.stringify({ account: addr, hash: `0x${'ab'.repeat(32)}`, hashKind: 'userop', createdAt: Date.now() }))
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    const fresh = await import('./passkey')

    expect(fresh.readPasskeySession()).toBeNull()
    expect(fresh.readPendingBackup(ACCOUNT)).toBeNull()
    fresh.savePasskeySession({ address: ACCOUNT, credentialId: 'cred-testnet' })
    fresh.markBackupSaved(ACCOUNT)

    expect(JSON.parse(localStorage.getItem('fundit.testnet.passkey')!)).toEqual({ address: ACCOUNT, credentialId: 'cred-testnet' })
    expect(localStorage.getItem(`fundit.testnet.backup.${addr}`)).toBe('1')
    // The mainnet records are untouched.
    expect(JSON.parse(localStorage.getItem('fundit.passkey')!)).toMatchObject({ credentialId: 'cred-mainnet' })
    fresh.clearPasskeySession()
    expect(localStorage.getItem('fundit.testnet.passkey')).toBeNull()
    expect(localStorage.getItem('fundit.passkey')).not.toBeNull()
  })
})
