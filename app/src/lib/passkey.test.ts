import { act, renderHook } from '@testing-library/react'
import { type Address, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TX_TIMEOUT_MS } from '../config'
import { pickWallet, setActiveWallet, useSender, useWalletChoice } from '../hooks/useSender'
import {
  addBackupPasskey,
  clearPasskeySession,
  dismissBackupPrompt,
  loginPasskey,
  markBackupSaved,
  newRecoveryPhrase,
  type PasskeyBundler,
  passkeySender,
  readPasskeySession,
  registerPasskey,
  savePasskeySession,
  storedPasskeySender,
  useBackupNeeded,
  useBackupPrompt,
  usePasskeySession,
} from './passkey'
import type { Call } from './sender'

// The flag is off in tests by default. useSender only looks for a passkey session when it is on.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  PASSKEYS_ENABLED: true,
  CIRCLE_CLIENT_KEY: 'test-key',
}))

// A fake of the lazily loaded SDK module. toWebAuthnCredential is the passkey prompt.
const kit = vi.hoisted(() => {
  const bundler = { waitForUserOperationReceipt: vi.fn(), estimateUserOperationGas: vi.fn(), sendUserOperation: vi.fn() }
  const registerRecoveryAddress = vi.fn()
  return {
    bundler,
    registerRecoveryAddress,
    generateMnemonic: vi.fn(() => 'one two three four five six seven eight nine ten eleven twelve'),
    english: [],
    mnemonicToAccount: vi.fn(() => ({ address: '0x00000000000000000000000000000000000000Ee' })),
    sdk: {
      recoveryActions: vi.fn(() => ({ registerRecoveryAddress })),
      toWebAuthnCredential: vi.fn(async () => ({ id: 'cred-live', publicKey: '0x', raw: {} })),
      toPasskeyTransport: vi.fn(() => ({})),
      toModularTransport: vi.fn(() => ({})),
      toCircleSmartAccount: vi.fn(async () => ({ address: '0x00000000000000000000000000000000000000cc' })),
      getUserOperationGasPrice: vi.fn(),
      WebAuthnMode: { Register: 'Register', Login: 'Login' },
    },
    createPublicClient: vi.fn(() => ({})),
    createBundlerClient: vi.fn(() => bundler),
    toWebAuthnAccount: vi.fn(() => ({})),
  }
})
vi.mock('./passkeyKit', () => kit)
// The account's USDC balance, read before a backup is added.
const balance = vi.hoisted(() => ({ value: 1_000_000n }))
vi.mock('./clients', () => ({ arcClient: { readContract: async () => balance.value } }))
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

const GAS = { callGasLimit: 100_003n, preVerificationGas: 50_000n, verificationGasLimit: 70_000n }

function bundler(over: Partial<PasskeyBundler<typeof ACCOUNT>> = {}) {
  const b = {
    estimateUserOperationGas: vi.fn(async (_args: { account: typeof ACCOUNT; calls: Call[] }) => GAS),
    sendUserOperation: vi.fn(async (_args: { account: typeof ACCOUNT; calls: Call[] } & typeof GAS) => OP_HASH),
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

  // Campaign._activity() skips two storage writes when its last activity is in the estimate's block, so the
  // estimate can be about 3,200 gas short. The call gas gets 25% on top; the other limits stay as estimated.
  it('sends the estimated call gas plus 25%, rounded down', async () => {
    const b = bundler()
    await passkeySender(ACCOUNT, b).send([A, B])
    expect(b.estimateUserOperationGas).toHaveBeenCalledWith({ account: ACCOUNT, calls: [A, B] })
    expect(b.sendUserOperation).toHaveBeenCalledWith({
      account: ACCOUNT,
      calls: [A, B],
      callGasLimit: 125_003n,
      preVerificationGas: 50_000n,
      verificationGasLimit: 70_000n,
    })
  })

  // One user operation carries every call, so its hash stands for the last one (the donation).
  it('reports the user operation hash for the last call before waiting for the receipt', async () => {
    const b = bundler()
    const onHash = vi.fn((_hash: Hex, _index: number) => expect(b.waitForUserOperationReceipt).not.toHaveBeenCalled())
    await passkeySender(ACCOUNT, b).send([A, B], { label: 'Donate', onHash })
    expect(onHash).toHaveBeenCalledWith(OP_HASH, 1)
  })

  it('sends nothing when the gas estimate reverts', async () => {
    const b = bundler({ estimateUserOperationGas: vi.fn(async () => Promise.reject(new Error('execution reverted'))) })
    await expect(passkeySender(ACCOUNT, b).send([A])).rejects.toThrow('execution reverted')
    expect(b.sendUserOperation).not.toHaveBeenCalled()
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
    expect(await pending).toEqual({ status: 'timeout', hash: OP_HASH, completed: 0, hashKind: 'userop' })
    expect(b.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: OP_HASH, timeout: TX_TIMEOUT_MS })
  })

  // The bundler may error during the wait after the operation was accepted. It may still be mined.
  it('reports timeout when the receipt wait fails', async () => {
    const b = bundler({ waitForUserOperationReceipt: vi.fn(async () => Promise.reject(new Error('socket hang up'))) })
    expect(await passkeySender(ACCOUNT, b).send([A])).toEqual({ status: 'timeout', hash: OP_HASH, completed: 0, hashKind: 'userop' })
  })

  // Closing the passkey prompt throws NotAllowedError. That is a cancel, not an error.
  it('reports a closed passkey prompt as rejected', async () => {
    const cancel = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
    const b = bundler({ sendUserOperation: vi.fn(async () => Promise.reject(new Error('Signing failed', { cause: cancel }))) })
    expect(await passkeySender(ACCOUNT, b).send([A])).toEqual({ status: 'rejected', completed: 0 })
  })
})

describe('recheck', () => {
  // "Check again" after a passkey timeout must find the operation by its user operation hash, then show the
  // real transaction, which is what the explorer knows.
  it('resolves a timed-out user operation to the real transaction hash', async () => {
    const b = bundler({ waitForUserOperationReceipt: vi.fn(async () => receipt(true)) })
    const res = await passkeySender(ACCOUNT, b).recheck!(OP_HASH)
    expect(b.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: OP_HASH, timeout: TX_TIMEOUT_MS })
    expect(res).toMatchObject({ status: 'success', hash: TX_HASH })
  })

  // After a reload the signing account is gone. Reading a receipt needs no signature, so no passkey prompt.
  it('rechecks a stored session through the bundler without a passkey prompt', async () => {
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(true))
    const s = storedPasskeySender({ address: ACCOUNT.address, credentialId: 'cred-1' })
    expect(await s.recheck!(OP_HASH)).toMatchObject({ status: 'success', hash: TX_HASH })
    expect(kit.sdk.toWebAuthnCredential).not.toHaveBeenCalled()
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

  // Without storage the login cannot be saved, but it must still hold for this page load.
  it('keeps the logged-in session for the page when localStorage throws', async () => {
    const boom = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    const { result } = renderHook(() => usePasskeySession())
    expect(result.current).toBeNull()
    await act(async () => {
      await loginPasskey()
    })
    expect(result.current).toEqual({ address: '0x00000000000000000000000000000000000000cc', credentialId: 'cred-live' })
    act(() => clearPasskeySession())
    expect(result.current).toBeNull()
  })
})

describe('useSender', () => {
  beforeEach(() => {
    clearPasskeySession()
    setActiveWallet('passkey')
  })

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

  // With both active the person chooses. The choice must change who signs, not only what the header says.
  it('returns the wallet sender once the person switches to the connected wallet, and back', () => {
    savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-1' })
    const { result } = renderHook(() => ({ sender: useSender(), choice: useWalletChoice() }))
    expect(result.current.choice).toMatchObject({ both: true, active: 'passkey', external: '0x9999999999999999999999999999999999999999' })
    act(() => result.current.choice.setActive('external'))
    expect(result.current.sender?.kind).toBe('eoa')
    expect(result.current.choice.active).toBe('external')
    act(() => setActiveWallet('passkey'))
    expect(result.current.sender?.kind).toBe('passkey')
  })
})

describe('pickWallet', () => {
  const P = { address: ACCOUNT.address, credentialId: 'c' }
  const E = '0x9999999999999999999999999999999999999999' as Address
  it('prefers the passkey by default, the chosen one when both exist, and whichever exists otherwise', () => {
    expect(pickWallet({ passkey: P, external: E, prefer: 'passkey' })).toBe('passkey')
    expect(pickWallet({ passkey: P, external: E, prefer: 'external' })).toBe('external')
    expect(pickWallet({ passkey: P, external: null, prefer: 'external' })).toBe('passkey')
    expect(pickWallet({ passkey: null, external: E, prefer: 'passkey' })).toBe('external')
    expect(pickWallet({ passkey: null, external: null, prefer: 'passkey' })).toBeNull()
  })
})

describe('interrupted sign-up', () => {
  // The passkey can be saved in the browser and on Circle's side before the account fails to load. The person
  // must be able to sign in with that passkey afterwards, not be stuck with a passkey that opens nothing.
  it('login works after an interrupted register', async () => {
    kit.sdk.toCircleSmartAccount.mockRejectedValueOnce(new Error('network down'))
    await expect(registerPasskey('ana')).rejects.toThrow('network down')
    expect(readPasskeySession()).toBeNull()
    await loginPasskey()
    expect(readPasskeySession()).toEqual({ address: '0x00000000000000000000000000000000000000cc', credentialId: 'cred-live' })
  })
})

describe('backup prompt', () => {
  afterEach(() => localStorage.clear())

  // Losing the only passkey loses the account for good, so a new account is asked straight away, and My page
  // keeps asking until a recovery key is saved, even after Later.
  it('asks a new account once, and keeps the backup needed until it is saved', async () => {
    const { result } = renderHook(() => {
      const stored = usePasskeySession()
      return { needed: useBackupNeeded(stored), prompt: useBackupPrompt(stored) }
    })
    expect(result.current).toEqual({ needed: false, prompt: false })
    await act(async () => {
      await registerPasskey('ana')
    })
    expect(result.current).toEqual({ needed: true, prompt: true })
    act(() => dismissBackupPrompt())
    expect(result.current).toEqual({ needed: true, prompt: false })
    act(() => markBackupSaved('0x00000000000000000000000000000000000000cc'))
    expect(result.current).toEqual({ needed: false, prompt: false })
  })

  // Signing in to an account that already exists is not the moment to interrupt. My page still asks.
  it('does not interrupt a returning sign-in', async () => {
    const { result } = renderHook(() => useBackupPrompt(usePasskeySession()))
    await act(async () => {
      await loginPasskey()
    })
    expect(result.current).toBe(false)
  })
})

describe('addBackupPasskey', () => {
  const stored = { address: getAddress('0x00000000000000000000000000000000000000cc') as Address, credentialId: 'cred-live' }

  beforeEach(() => {
    balance.value = 1_000_000n
    kit.registerRecoveryAddress.mockReset()
    kit.registerRecoveryAddress.mockResolvedValue(OP_HASH)
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(true))
  })

  it('makes a 12-word recovery phrase', async () => {
    expect((await newRecoveryPhrase()).split(' ')).toHaveLength(12)
  })

  // Circle's recovery support: the phrase's address becomes a recovery owner of the account. No paymaster: the
  // account pays the gas, and the call only counts once the user operation succeeds.
  it('registers the phrase address as the recovery address with no paymaster', async () => {
    await addBackupPasskey(stored, 'one two three')
    expect(kit.mnemonicToAccount).toHaveBeenCalledWith('one two three')
    expect(kit.registerRecoveryAddress).toHaveBeenCalledTimes(1)
    const args = kit.registerRecoveryAddress.mock.calls[0]![0]
    expect(args.recoveryAddress).toBe('0x00000000000000000000000000000000000000Ee')
    expect(args.account.address).toBe('0x00000000000000000000000000000000000000cc')
    expect(args.paymaster).toBeUndefined()
  })

  // The gas comes out of the account's USDC. Below the buffer the bundler would refuse with a code nobody can read.
  it('refuses with a plain message when the account cannot pay the gas', async () => {
    balance.value = 49_999n
    await expect(addBackupPasskey(stored, 'one two three')).rejects.toThrow('Add at least 0.05 USDC')
    expect(kit.registerRecoveryAddress).not.toHaveBeenCalled()
  })

  it('fails when the user operation reverts', async () => {
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(false))
    await expect(addBackupPasskey(stored, 'one two three')).rejects.toThrow()
  })
})
