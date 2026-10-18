import { act, renderHook } from '@testing-library/react'
import { type Address, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TX_TIMEOUT_MS } from '../config'
import { pickWallet, setActiveWallet, useSender, useWalletChoice } from '../hooks/useSender'
import {
  addBackupPasskey,
  checkPendingBackup,
  clearPasskeySession,
  discardPendingBackup,
  dismissBackupPrompt,
  checkPendingRecovery,
  isValidRecoveryPhrase,
  loginPasskey,
  markBackupSaved,
  newRecoveryPhrase,
  type PasskeyBundler,
  passkeySender,
  readPasskeySession,
  readPendingBackup,
  readPendingRecovery,
  RecoveryNeedsFunds,
  recoverWithPhrase,
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
  const estimateRegisterRecoveryAddressGas = vi.fn()
  const executeRecovery = vi.fn()
  const estimateExecuteRecoveryGas = vi.fn()
  return {
    bundler,
    registerRecoveryAddress,
    estimateRegisterRecoveryAddressGas,
    executeRecovery,
    estimateExecuteRecoveryGas,
    generateMnemonic: vi.fn(() => 'one two three four five six seven eight nine ten eleven twelve'),
    english: [],
    mnemonicToAccount: vi.fn(() => ({ address: '0x00000000000000000000000000000000000000Ee' })),
    sdk: {
      recoveryActions: vi.fn(() => ({ registerRecoveryAddress, estimateRegisterRecoveryAddressGas, executeRecovery, estimateExecuteRecoveryGas })),
      getAddressMapping: vi.fn(),
      toWebAuthnCredential: vi.fn(async () => ({ id: 'cred-live', publicKey: '0x', raw: {} })),
      toPasskeyTransport: vi.fn(() => ({})),
      toModularTransport: vi.fn(() => ({})),
      toCircleSmartAccount: vi.fn(async () => ({ address: '0x00000000000000000000000000000000000000cc' })),
      getUserOperationGasPrice: vi.fn(),
      WebAuthnMode: { Register: 'Register', Login: 'Login' },
      OwnerIdentifierType: { EOA: 'EOAOWNER', WebAuthn: 'WEBAUTHOWNER' },
    },
    createPublicClient: vi.fn(() => ({})),
    createBundlerClient: vi.fn(() => bundler),
    toWebAuthnAccount: vi.fn(() => ({})),
  }
})
// The real BIP-39 word list, so the checksum check runs for real.
vi.mock('./passkeyKit', async () =>
  Object.assign(kit, {
    english: (await vi.importActual<typeof import('viem/accounts')>('viem/accounts')).english,
    validateMnemonic: (await vi.importActual<typeof import('@scure/bip39')>('@scure/bip39')).validateMnemonic,
    bip39English: (await vi.importActual<typeof import('@scure/bip39/wordlists/english')>('@scure/bip39/wordlists/english')).wordlist,
  }),
)
// The account's USDC balance, read before a backup is added.
const balance = vi.hoisted(() => ({ value: 1_000_000n }))
// Deployed code per address (lower case), for picking the live account when a key maps to several.
const code = vi.hoisted(() => new Map<string, string>())
vi.mock('./clients', () => ({
  arcClient: { readContract: async () => balance.value, getCode: async ({ address }: { address: string }) => code.get(address.toLowerCase()) },
}))
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
  const PHRASE = 'one two three four five six seven eight nine ten eleven twelve'
  const saved = () => localStorage.getItem('fundit.backup.0x00000000000000000000000000000000000000cc') === '1'

  beforeEach(() => {
    balance.value = 1_000_000n
    kit.registerRecoveryAddress.mockReset()
    kit.registerRecoveryAddress.mockResolvedValue(OP_HASH)
    kit.estimateRegisterRecoveryAddressGas.mockReset()
    kit.estimateRegisterRecoveryAddressGas.mockResolvedValue(GAS)
    kit.bundler.waitForUserOperationReceipt.mockReset()
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(true))
    kit.sdk.toWebAuthnCredential.mockClear()
  })
  afterEach(() => localStorage.clear())

  it('makes a 12-word recovery phrase', async () => {
    expect((await newRecoveryPhrase()).split(' ')).toHaveLength(12)
  })

  // Circle's recovery support: the phrase's address becomes an owner of the account. No paymaster: the account
  // pays the gas, with the same call gas margin as every other send. Saved only once the operation succeeds.
  it('registers the phrase address with the gas margin and no paymaster, then marks the backup saved', async () => {
    expect(await addBackupPasskey(stored, PHRASE)).toBe('added')
    expect(kit.mnemonicToAccount).toHaveBeenCalledWith(PHRASE)
    expect(kit.registerRecoveryAddress).toHaveBeenCalledTimes(1)
    const args = kit.registerRecoveryAddress.mock.calls[0]![0]
    expect(args.recoveryAddress).toBe('0x00000000000000000000000000000000000000Ee')
    expect(args.account.address).toBe('0x00000000000000000000000000000000000000cc')
    expect(args.paymaster).toBeUndefined()
    expect(args).toMatchObject({ callGasLimit: 125_003n, preVerificationGas: 50_000n, verificationGasLimit: 70_000n })
    expect(saved()).toBe(true)
    expect(readPendingBackup(stored.address)).toBeNull()
  })

  // The gas comes out of the account's USDC. Below the buffer the bundler would refuse with a code nobody can read.
  it('refuses with a plain message when the account cannot pay the gas', async () => {
    balance.value = 49_999n
    await expect(addBackupPasskey(stored, PHRASE)).rejects.toThrow('Add at least 0.05 USDC')
    expect(kit.registerRecoveryAddress).not.toHaveBeenCalled()
  })

  it('fails when the user operation reverts, and marks nothing saved', async () => {
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(false))
    await expect(addBackupPasskey(stored, PHRASE)).rejects.toThrow('The backup did not go through.')
    expect(saved()).toBe(false)
    expect(readPendingBackup(stored.address)).toBeNull()
  })

  // A backup that may still land must never be followed by a second one with other words: that would leave an
  // owner nobody holds the words for. Only the account and the hash are stored, never the words.
  it('keeps a timed-out backup pending, blocks a new one, and resolves it with recheck, not a resend', async () => {
    kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
    expect(await addBackupPasskey(stored, PHRASE)).toBe('pending')
    const pending = readPendingBackup(stored.address)
    expect(pending).toMatchObject({ account: stored.address, hash: OP_HASH, hashKind: 'userop' })
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('twelve')
    }
    await expect(addBackupPasskey(stored, PHRASE)).rejects.toThrow('still confirming')
    expect(kit.registerRecoveryAddress).toHaveBeenCalledTimes(1)

    clearPasskeySession()
    kit.sdk.toWebAuthnCredential.mockClear()
    expect(await checkPendingBackup(stored)).toBe('added')
    expect(kit.sdk.toWebAuthnCredential).not.toHaveBeenCalled()
    expect(kit.registerRecoveryAddress).toHaveBeenCalledTimes(1)
    expect(readPendingBackup(stored.address)).toBeNull()
    expect(saved()).toBe(true)
  })

  it('clears a pending backup that reverted, so a new one can start', async () => {
    kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
    await addBackupPasskey(stored, PHRASE)
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(false))
    await expect(checkPendingBackup(stored)).rejects.toThrow('The backup did not go through.')
    expect(readPendingBackup(stored.address)).toBeNull()
    expect(saved()).toBe(false)
  })

  // addOwners reverts InvalidOwner for an address that is already an owner. With the same words that means an
  // earlier attempt landed, so a retry reports success instead of an error.
  // The plugin's owner id for an address is bytes30(uint240(uint160(addr))): ten zero bytes, then the address.
  // As an ABI word, bytes30 is left-aligned, so two zero bytes follow.
  const invalidOwner = (addr: string) => `0xb7ed090c${'00'.repeat(10)}${addr.slice(2).toLowerCase()}0000`

  it('reports success when the recovery address is already an owner', async () => {
    kit.estimateRegisterRecoveryAddressGas.mockRejectedValue(
      new Error(`UserOperation reverted during simulation with reason: ${invalidOwner('0x00000000000000000000000000000000000000Ee')}`),
    )
    expect(await addBackupPasskey(stored, PHRASE)).toBe('added')
    expect(kit.registerRecoveryAddress).not.toHaveBeenCalled()
    expect(saved()).toBe(true)
  })

  // InvalidOwner for some other owner id is a real failure, not proof that this key landed.
  it('surfaces InvalidOwner for a different owner as an error', async () => {
    kit.estimateRegisterRecoveryAddressGas.mockRejectedValue(
      new Error(`UserOperation reverted during simulation with reason: ${invalidOwner('0x1111111111111111111111111111111111111111')}`),
    )
    await expect(addBackupPasskey(stored, PHRASE)).rejects.toThrow('reverted')
    expect(saved()).toBe(false)
  })

  // A dropped user operation must not block a recovery key in this browser forever.
  it('calls a pending backup stuck only after 30 minutes without a receipt, and Start over clears it', async () => {
    const key = 'fundit.backup.pending.0x00000000000000000000000000000000000000cc'
    const record = (ageMs: number) => JSON.stringify({ account: stored.address, hash: OP_HASH, hashKind: 'userop', createdAt: Date.now() - ageMs })
    kit.bundler.waitForUserOperationReceipt.mockRejectedValue(new Error('not found'))
    localStorage.setItem(key, record(29 * 60_000))
    expect(await checkPendingBackup(stored)).toBe('pending')
    localStorage.setItem(key, record(31 * 60_000))
    expect(await checkPendingBackup(stored)).toBe('stuck')
    expect(readPendingBackup(stored.address)).not.toBeNull()
    discardPendingBackup(stored.address)
    expect(readPendingBackup(stored.address)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })

  // Same rule as bridge.ts: records older than 7 days are dropped on read.
  it('prunes a pending backup older than 7 days', () => {
    const key = 'fundit.backup.pending.0x00000000000000000000000000000000000000cc'
    localStorage.setItem(key, JSON.stringify({ account: stored.address, hash: OP_HASH, hashKind: 'userop', createdAt: Date.now() - 7 * 24 * 3600_000 - 1 }))
    expect(readPendingBackup(stored.address)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })
})

describe('interrupted sign-up and the backup prompt', () => {
  afterEach(() => localStorage.clear())

  // The account is not known as new when sign-up failed, so the dialog does not appear after the following
  // login. My page still asks for the backup. Accepted behaviour, pinned here.
  it('does not show the new-account prompt after an interrupted register and a login, but My page still asks', async () => {
    const { result } = renderHook(() => {
      const stored = usePasskeySession()
      return { needed: useBackupNeeded(stored), prompt: useBackupPrompt(stored) }
    })
    kit.sdk.toCircleSmartAccount.mockRejectedValueOnce(new Error('network down'))
    await act(async () => {
      await expect(registerPasskey('ana')).rejects.toThrow('network down')
    })
    await act(async () => {
      await loginPasskey()
    })
    expect(result.current).toEqual({ needed: true, prompt: false })
  })
})

describe('recoverWithPhrase', () => {
  // BIP-39 test vectors (entropy 0x7f repeated, and all zeros). Both have a valid checksum.
  const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
  const RECOVERED = getAddress('0x00000000000000000000000000000000000000Ab') as Address
  const NEW_CRED = { id: 'cred-new', publicKey: '0x04', raw: {} }
  const pendingKey = 'fundit.recovery.pending.0x00000000000000000000000000000000000000ab'
  const fetchSpy = vi.fn()

  beforeEach(() => {
    balance.value = 1_000_000n
    kit.mnemonicToAccount.mockClear()
    kit.sdk.toWebAuthnCredential.mockReset()
    kit.sdk.toWebAuthnCredential.mockResolvedValue(NEW_CRED)
    kit.sdk.toCircleSmartAccount.mockClear()
    kit.sdk.getAddressMapping.mockReset()
    kit.sdk.getAddressMapping.mockResolvedValue([{ walletAddress: RECOVERED, owner: {} }])
    kit.executeRecovery.mockReset()
    kit.executeRecovery.mockResolvedValue(OP_HASH)
    kit.estimateExecuteRecoveryGas.mockReset()
    kit.estimateExecuteRecoveryGas.mockResolvedValue(GAS)
    kit.bundler.waitForUserOperationReceipt.mockReset()
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(true))
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  const sdkCalls = () => [
    kit.sdk.toWebAuthnCredential,
    kit.sdk.toCircleSmartAccount,
    kit.sdk.getAddressMapping,
    kit.executeRecovery,
    kit.estimateExecuteRecoveryGas,
    kit.bundler.waitForUserOperationReceipt,
  ]

  it('checks the BIP-39 checksum and the word count', async () => {
    expect(await isValidRecoveryPhrase(PHRASE)).toBe(true)
    expect(await isValidRecoveryPhrase(`${'abandon '.repeat(11)}about`)).toBe(true)
    // Real words, wrong checksum.
    expect(await isValidRecoveryPhrase('abandon '.repeat(12).trim())).toBe(false)
    expect(await isValidRecoveryPhrase(PHRASE.split(' ').slice(0, 11).join(' '))).toBe(false)
    expect(await isValidRecoveryPhrase(PHRASE.replace('sausage', 'sausagex'))).toBe(false)
  })

  // A typo must never reach Circle or the passkey prompt: nothing goes out until the words check out.
  it.each([
    ['a bad checksum', 'abandon '.repeat(12).trim()],
    ['11 words', PHRASE.split(' ').slice(0, 11).join(' ')],
  ])('refuses %s before any SDK call', async (_name, phrase) => {
    await expect(recoverWithPhrase({ phrase, username: 'ana' })).rejects.toThrow(
      "Those words don't form a valid recovery key. Check the order and spelling.",
    )
    for (const fn of sdkCalls()) expect(fn).not.toHaveBeenCalled()
    expect(kit.mnemonicToAccount).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The recovery key's address finds the account (Circle mapped it when the key was added). A new passkey is
  // made, and the phrase's local account signs executeRecovery, which adds that passkey as an owner. The account
  // pays the gas in USDC: no paymaster, and the same call gas margin as every other send.
  it('finds the account, registers a new passkey, runs the recovery and saves the new session', async () => {
    const res = await recoverWithPhrase({ phrase: `  ${PHRASE.toUpperCase().replace(/ /g, '   ')} `, username: '  ana  ' })
    expect(kit.mnemonicToAccount).toHaveBeenCalledWith(PHRASE)
    expect(kit.sdk.getAddressMapping).toHaveBeenCalledWith(expect.anything(), {
      owner: { type: 'EOAOWNER', identifier: { address: '0x00000000000000000000000000000000000000Ee' } },
    })
    expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(1)
    expect((kit.sdk.toWebAuthnCredential.mock.calls[0] as unknown[])[0]).toMatchObject({ mode: 'Register', username: 'ana' })
    const owner = kit.mnemonicToAccount.mock.results[0]!.value
    expect(kit.sdk.toCircleSmartAccount).toHaveBeenLastCalledWith(expect.objectContaining({ owner, address: RECOVERED }))
    expect(kit.executeRecovery).toHaveBeenCalledTimes(1)
    const args = kit.executeRecovery.mock.calls[0]![0]
    expect(args.credential).toBe(NEW_CRED)
    expect(args.account.address).toBe('0x00000000000000000000000000000000000000cc')
    expect(args.paymaster).toBeUndefined()
    expect(args).toMatchObject({ callGasLimit: 125_003n, preVerificationGas: 50_000n, verificationGasLimit: 70_000n })
    expect(res).toEqual({ status: 'recovered', session: { address: RECOVERED, credentialId: 'cred-new' } })
    expect(readPasskeySession()).toEqual({ address: RECOVERED, credentialId: 'cred-new' })
    expect(localStorage.getItem(pendingKey)).toBeNull()
  })

  // The old recovery key should be treated as exposed, so My page asks for a new one.
  it('asks for a new recovery key after a recovery', async () => {
    markBackupSaved(RECOVERED)
    await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })
    expect(localStorage.getItem('fundit.backup.0x00000000000000000000000000000000000000ab')).toBeNull()
  })

  // The words control a money account. Only derived addresses and signatures may leave the browser.
  it('never stores the phrase or sends it in any network call', async () => {
    kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
    await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })
    const stores = [localStorage, sessionStorage]
    for (const store of stores) {
      for (let i = 0; i < store.length; i++) {
        const value = `${store.key(i)} ${store.getItem(store.key(i)!)}`
        for (const word of ['sausage', 'useful', 'yellow', PHRASE]) expect(value).not.toContain(word)
      }
    }
    const seen = JSON.stringify(
      sdkCalls().flatMap((fn) => fn.mock.calls),
      (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    )
    for (const word of ['sausage', 'useful', 'yellow']) expect(seen).not.toContain(word)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Circle may know more than one wallet for the key's address (toCircleSmartAccount asks circle_getAddress for
  // it). Only the deployed one can be the Fundit account that added this key.
  it('picks the deployed account when the key maps to several wallets, and refuses when that is still ambiguous', async () => {
    const OTHER = '0x00000000000000000000000000000000000000Cd'
    kit.sdk.getAddressMapping.mockResolvedValue([
      { walletAddress: OTHER, owner: {} },
      { walletAddress: RECOVERED, owner: {} },
    ])
    code.set(RECOVERED.toLowerCase(), '0x6001')
    expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({
      status: 'recovered',
      session: { address: RECOVERED, credentialId: 'cred-new' },
    })
    code.set(OTHER.toLowerCase(), '0x6001')
    await expect(recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).rejects.toThrow('more than one account')
    code.clear()
  })

  it('refuses when no Fundit account uses this recovery key', async () => {
    kit.sdk.getAddressMapping.mockResolvedValue([])
    await expect(recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).rejects.toThrow("We couldn't find a Fundit account for this recovery key.")
    expect(kit.sdk.toWebAuthnCredential).not.toHaveBeenCalled()
  })

  // The account pays the fee. Below the buffer, the person is told to fund the account first, and no passkey
  // is made yet.
  it('asks to fund the account first when its balance is below the gas buffer', async () => {
    balance.value = 49_999n
    const err = await recoverWithPhrase({ phrase: PHRASE, username: 'ana' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RecoveryNeedsFunds)
    expect((err as RecoveryNeedsFunds).account).toBe(RECOVERED)
    expect(kit.sdk.toWebAuthnCredential).not.toHaveBeenCalled()
    expect(kit.executeRecovery).not.toHaveBeenCalled()
  })

  // Same discipline as the backup: a recovery that may still land is never sent again.
  it('keeps a timed-out recovery pending without the phrase, blocks a second one, and finishes it with recheck', async () => {
    kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
    expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({ status: 'pending', account: RECOVERED })
    expect(readPendingRecovery(RECOVERED)).toMatchObject({ account: RECOVERED, hash: OP_HASH, hashKind: 'userop', credentialId: 'cred-new' })
    expect(localStorage.getItem(pendingKey)).not.toContain('sausage')
    expect(readPasskeySession()).toBeNull()

    expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({ status: 'pending', account: RECOVERED })
    expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(1)
    expect(kit.executeRecovery).toHaveBeenCalledTimes(1)

    expect(await checkPendingRecovery(RECOVERED)).toEqual({ status: 'recovered', session: { address: RECOVERED, credentialId: 'cred-new' } })
    expect(kit.executeRecovery).toHaveBeenCalledTimes(1)
    expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(1)
    expect(readPendingRecovery(RECOVERED)).toBeNull()
    expect(readPasskeySession()).toEqual({ address: RECOVERED, credentialId: 'cred-new' })
  })

  it('clears a recovery that reverted, so the person can try again', async () => {
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(false))
    await expect(recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).rejects.toThrow('The recovery did not go through.')
    expect(readPendingRecovery(RECOVERED)).toBeNull()
    expect(readPasskeySession()).toBeNull()
  })
})
