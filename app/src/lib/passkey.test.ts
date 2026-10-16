import { renderHook } from '@testing-library/react'
import { type Address, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TX_TIMEOUT_MS } from '../config'
import { useSender } from '../hooks/useSender'
import { clearPasskeySession, type PasskeyBundler, passkeySender, readPasskeySession, savePasskeySession } from './passkey'
import type { Call } from './sender'

// The flag is off in tests by default. useSender only looks for a passkey session when it is on.
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), PASSKEYS_ENABLED: true }))
vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  useConnection: () => ({ address: '0x9999999999999999999999999999999999999999', isConnected: true }),
}))

const ACCOUNT = { address: getAddress('0x00000000000000000000000000000000000000cc') as Address }
const A: Call = { to: '0x00000000000000000000000000000000000000a1', data: '0x01' }
const B: Call = { to: '0x00000000000000000000000000000000000000b2', data: '0x02' }
const OP_HASH = `0x${'1'.repeat(64)}` as Hex
const TX_HASH = `0x${'2'.repeat(64)}` as Hex

function receipt(success: boolean) {
  return { success, receipt: { transactionHash: TX_HASH, status: 'success' } as TransactionReceipt }
}

function bundler(over: Partial<PasskeyBundler<typeof ACCOUNT>> = {}) {
  const b = {
    sendUserOperation: vi.fn(async (_args: { account: typeof ACCOUNT; calls: Call[] }) => OP_HASH),
    waitForUserOperationReceipt: vi.fn(async (_args: { hash: Hex; timeout?: number }) => receipt(true)),
  }
  return Object.assign(b, over) as typeof b
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearPasskeySession()
})

describe('passkeySender', () => {
  // A smart account runs every call in one user operation, so an approve and a donate land together or not at all.
  it('sends all calls in order as one user operation with no paymaster', async () => {
    const b = bundler()
    const res = await passkeySender(ACCOUNT, b).send([A, B])
    expect(b.sendUserOperation).toHaveBeenCalledTimes(1)
    const args = b.sendUserOperation.mock.calls[0]![0] as Record<string, unknown>
    expect(args.account).toBe(ACCOUNT)
    expect(args.calls).toEqual([A, B])
    // The $0 rule: no gas sponsorship. The account pays its own gas in USDC on Arc.
    expect('paymaster' in args).toBe(false)
    expect(res).toMatchObject({ status: 'success', hash: TX_HASH })
  })

  it('is a passkey sender at the account address', () => {
    const s = passkeySender(ACCOUNT, bundler())
    expect(s.kind).toBe('passkey')
    expect(s.address).toBe(ACCOUNT.address)
  })

  // A user operation can be mined while its calls revert. That is a failure, never success.
  it('reports a user operation with success false as reverted', async () => {
    const b = bundler({ waitForUserOperationReceipt: vi.fn(async () => receipt(false)) })
    const res = await passkeySender(ACCOUNT, b).send([A, B])
    expect(res).toMatchObject({ status: 'reverted', hash: TX_HASH, completed: 0 })
  })

  // A dropped operation must not spin forever or look like success.
  it('reports timeout when the receipt does not arrive in time', async () => {
    vi.useFakeTimers()
    const b = bundler({ waitForUserOperationReceipt: vi.fn(() => new Promise<never>(() => {})) })
    const pending = passkeySender(ACCOUNT, b).send([A])
    await vi.advanceTimersByTimeAsync(TX_TIMEOUT_MS + 1)
    expect(await pending).toEqual({ status: 'timeout', hash: OP_HASH, completed: 0 })
    expect(b.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: OP_HASH, timeout: TX_TIMEOUT_MS })
  })

  // The bundler may error during the wait after the operation was accepted. It may still be mined.
  it('reports timeout when the receipt wait fails', async () => {
    const b = bundler({ waitForUserOperationReceipt: vi.fn(async () => Promise.reject(new Error('socket hang up'))) })
    expect(await passkeySender(ACCOUNT, b).send([A])).toEqual({ status: 'timeout', hash: OP_HASH, completed: 0 })
  })

  // Closing the passkey prompt throws NotAllowedError. That is a cancel, not an error.
  it('reports a closed passkey prompt as rejected', async () => {
    const cancel = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
    const b = bundler({ sendUserOperation: vi.fn(async () => Promise.reject(new Error('Signing failed', { cause: cancel }))) })
    expect(await passkeySender(ACCOUNT, b).send([A])).toEqual({ status: 'rejected', completed: 0 })
  })
})

describe('passkey session store', () => {
  it('saves only the address and credential id', () => {
    savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-1' })
    expect(JSON.parse(localStorage.getItem('fundit.passkey')!)).toEqual({ address: ACCOUNT.address, credentialId: 'cred-1' })
    expect(readPasskeySession()).toEqual({ address: ACCOUNT.address, credentialId: 'cred-1' })
  })

  it('ignores a stored value that is not a session', () => {
    localStorage.setItem('fundit.passkey', JSON.stringify({ address: 'nope', credentialId: 1 }))
    expect(readPasskeySession()).toBeNull()
  })

  // Private windows and blocked site data throw on every access. The app must keep working without a session.
  it('survives a localStorage that throws', () => {
    const boom = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    expect(() => savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-1' })).not.toThrow()
    expect(readPasskeySession()).toBeNull()
    expect(() => clearPasskeySession()).not.toThrow()
  })
})

describe('useSender', () => {
  beforeEach(() => clearPasskeySession())

  // A logged-in passkey wallet is who acts, even if an external wallet is also connected for bridging.
  it('returns the passkey sender when a passkey session exists', () => {
    savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-1' })
    const { result } = renderHook(() => useSender())
    expect(result.current?.kind).toBe('passkey')
    expect(result.current?.address).toBe(ACCOUNT.address)
  })

  it('returns the wallet sender without a passkey session', () => {
    const { result } = renderHook(() => useSender())
    expect(result.current?.kind).toBe('eoa')
  })
})
