import { act, renderHook } from '@testing-library/react'
import type { Address } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { storageKey } from '../config'
import { clearOtherSessions, confirmLine, useAccount } from './account'

const WALLET = '0x1111111111111111111111111111111111111111' as Address
const PASSKEY = '0x2222222222222222222222222222222222222222' as Address
const EMAIL = '0x3333333333333333333333333333333333333333' as Address

const walletKey = storageKey('session.wallet')
const emailKey = storageKey('session.email')
const passkeyKey = storageKey('passkey')

afterEach(() => localStorage.clear())

describe('useAccount', () => {
  it('returns null when signed out', () => {
    const { result } = renderHook(() => useAccount())
    expect(result.current).toBeNull()
  })

  it('returns the wallet account from its store', () => {
    localStorage.setItem(walletKey, JSON.stringify({ address: WALLET, connectorId: 'io.metamask' }))
    const { result } = renderHook(() => useAccount())
    expect(result.current).toEqual({ kind: 'wallet', address: WALLET })
  })

  it('returns the email account from its store', () => {
    localStorage.setItem(emailKey, JSON.stringify({ address: EMAIL, walletId: 'w-1', email: 'ana@example.com' }))
    const { result } = renderHook(() => useAccount())
    expect(result.current).toEqual({ kind: 'email', address: EMAIL })
  })

  // A browser that signed in with a passkey before the update still holds that key. It must read as signed out.
  it('an old passkey session key is ignored (signed out)', () => {
    localStorage.setItem(passkeyKey, JSON.stringify({ address: PASSKEY, credentialId: 'cred-1' }))
    const { result } = renderHook(() => useAccount())
    expect(result.current).toBeNull()
  })

  // Signing in with a wallet in one tab must move every other tab to that account, or a tab still showing the
  // old account would act for it.
  it('follows a sign-in from another tab', () => {
    const { result } = renderHook(() => useAccount())
    expect(result.current).toBeNull()
    act(() => {
      localStorage.setItem(walletKey, JSON.stringify({ address: WALLET, connectorId: 'io.metamask' }))
      window.dispatchEvent(new StorageEvent('storage', { key: walletKey }))
    })
    expect(result.current).toEqual({ kind: 'wallet', address: WALLET })
  })
})

describe('clearOtherSessions', () => {
  // One account at a time: a stale email session would come back after the wallet signs out.
  it("clearOtherSessions('wallet') clears the email store", () => {
    localStorage.setItem(emailKey, JSON.stringify({ address: EMAIL, walletId: 'w-1', email: 'ana@example.com' }))
    localStorage.setItem(walletKey, JSON.stringify({ address: WALLET, connectorId: 'io.metamask' }))
    clearOtherSessions('wallet')
    expect(localStorage.getItem(emailKey)).toBeNull()
    expect(localStorage.getItem(walletKey)).not.toBeNull()
  })
})

describe('confirmLine', () => {
  it('names the prompt each kind of account shows', () => {
    expect(confirmLine('email')).toBe('Approve in the Circle window')
    expect(confirmLine('wallet')).toBe('Confirm in your wallet')
  })
})
