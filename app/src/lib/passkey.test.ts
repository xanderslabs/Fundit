import { act, renderHook } from '@testing-library/react'
import { type Address, decodeFunctionData, erc20Abi, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CIRCLE_MULTISIG_PLUGIN, ENTRY_POINT, RESERVE_FALLBACK, RESERVE_FALLBACK_NEW_ACCOUNT, TX_TIMEOUT_MS } from '../config'
import { useSender } from '../hooks/useSender'
import {
  addBackupPasskey,
  checkPendingBackup,
  clearPasskeySession,
  discardPendingBackup,
  dismissBackupPrompt,
  checkPendingRecovery,
  discardPendingRecovery,
  isValidRecoveryPhrase,
  loginPasskey,
  markBackupSaved,
  newRecoveryPhrase,
  passkeyReserve,
  type PasskeyBundler,
  passkeySender,
  readPasskeySession,
  readPendingBackup,
  readPendingRecovery,
  RecoveryNeedsFunds,
  recoverWithPhrase,
  registerPasskey,
  reserveFor,
  savePasskeySession,
  storedPasskeySender,
  syncBackupFromChain,
  useBackupNeeded,
  useBackupPrompt,
  usePasskeySession,
} from './passkey'
import type { Call } from './sender'

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
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
      // 1,000 gwei, about Circle's fee on Arc testnet.
      getUserOperationGasPrice: vi.fn(async () => {
        const tier = { maxFeePerGas: '1000000000000', maxPriorityFeePerGas: '960000000000' }
        return { low: tier, medium: tier, high: tier }
      }),
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
// The account's EntryPoint deposit, in native wei.
const deposit = vi.hoisted(() => ({ value: 0n }))
// Deployed code per address (lower case), for picking the live account when a key maps to several.
const code = vi.hoisted(() => new Map<string, string>())
// The account's owners in Circle's multisig plugin: owner ids only, the rest of ownershipInfoOf is not read.
const owners = vi.hoisted(() => ({ ids: [] as string[], data: [] as unknown[], fail: false, hang: false, reads: [] as unknown[] }))
vi.mock('./clients', () => ({
  arcClient: {
    readContract: async (args: { functionName: string; address: string }) => {
      if (args.address === ENTRY_POINT) return deposit.value
      if (args.functionName !== 'ownershipInfoOf') return balance.value
      owners.reads.push(args)
      if (owners.fail) throw new Error('rpc down')
      return [owners.ids, owners.data, 1n]
    },
    getCode: ({ address }: { address: string }) =>
      owners.hang ? new Promise<undefined>(() => {}) : Promise.resolve(code.get(address.toLowerCase())),
  },
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
  })

  // A logged-in Fundit account is who acts, even while a regular wallet is connected to add money.
  it('returns the passkey sender when a passkey session exists, even with a wallet connected', () => {
    savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-1' })
    const { result } = renderHook(() => useSender())
    expect(result.current?.kind).toBe('passkey')
    expect(result.current?.address).toBe(ACCOUNT.address)
  })

  // Sign-in is passkey only. A wallet connected for Add money must never give, create or manage.
  it('never returns a wagmi sender: a connected wallet alone is signed out', () => {
    const { result } = renderHook(() => useSender())
    expect(result.current).toBeNull()
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

describe('backup from the chain', () => {
  const stored = { address: getAddress('0x00000000000000000000000000000000000000cc') as Address, credentialId: 'cred-live' }
  const flag = () => localStorage.getItem('fundit.backup.0x00000000000000000000000000000000000000cc')
  const PASSKEY_ID = `0x${'95'.repeat(30)}`
  const KEY_ID = `0x${'00'.repeat(10)}${'d2'.repeat(20)}`
  afterEach(() => {
    localStorage.clear()
    code.clear()
    owners.ids = []
    owners.fail = false
    owners.hang = false
    owners.reads = []
  })

  // A hanging RPC must not hide the prompt for long. After 8 seconds the read gives up, and My page falls back
  // to the browser's flag.
  it('gives up on a read that hangs for 8 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    owners.hang = true
    const read = syncBackupFromChain(stored.address)
    const outcome = read.then(
      () => 'answered',
      () => 'gave up',
    )
    await vi.advanceTimersByTimeAsync(7_999)
    let settled = false
    void outcome.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBe('gave up')
    expect(flag()).toBeNull()
  })

  // A recovery key added in another browser leaves no flag here. The account's owners on Arc are the record,
  // so a second owner means the backup exists and the prompt must not ask for another one.
  it('treats a second owner on chain as a saved backup and remembers it', async () => {
    code.set(stored.address.toLowerCase(), '0x6001')
    owners.ids = [PASSKEY_ID, KEY_ID]
    const { result } = renderHook(() => useBackupNeeded(stored))
    expect(result.current).toBe(true)
    await act(async () => {
      expect(await syncBackupFromChain(stored.address)).toBe(true)
    })
    expect(result.current).toBe(false)
    expect(flag()).toBe('1')
    expect(owners.reads[0]).toMatchObject({ address: CIRCLE_MULTISIG_PLUGIN, functionName: 'ownershipInfoOf', args: [stored.address] })
  })

  it('keeps asking when the passkey is the only owner', async () => {
    code.set(stored.address.toLowerCase(), '0x6001')
    owners.ids = [PASSKEY_ID]
    expect(await syncBackupFromChain(stored.address)).toBe(false)
    expect(flag()).toBeNull()
  })

  // Circle deploys the account with its first user operation. Before that its only owner is the passkey.
  it('keeps asking for an account that is not deployed yet, without reading the plugin', async () => {
    expect(await syncBackupFromChain(stored.address)).toBe(false)
    expect(owners.reads).toHaveLength(0)
    expect(flag()).toBeNull()
  })

  // A failed read must not hide the prompt: the caller falls back to this browser's flag.
  it('rejects on a failed read and leaves the flag alone', async () => {
    code.set(stored.address.toLowerCase(), '0x6001')
    owners.fail = true
    await expect(syncBackupFromChain(stored.address)).rejects.toThrow('rpc down')
    expect(flag()).toBeNull()
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

  // The gas comes out of the account's USDC, and the EntryPoint takes the whole prefund first. Short of it the
  // bundler would refuse with a code nobody can read. GAS at 1,000 gwei with the margins is 0.31 USDC.
  it('refuses with a plain message when the account cannot pay the prefund', async () => {
    balance.value = 300_000n
    await expect(addBackupPasskey(stored, PHRASE)).rejects.toThrow('Add at least 0.31 USDC')
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
    // An account with a recovery key is deployed.
    code.set(RECOVERED.toLowerCase(), '0x6001')
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
    code.clear()
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
    // No passkey for this account on this page, so the deployed-account fallback, shown as the real number.
    expect((err as RecoveryNeedsFunds).reserve).toBe(RESERVE_FALLBACK)
    expect((err as Error).message).toBe('Recovery needs a small network fee. Send at least 0.50 USDC on Arc to your account address first.')
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

  // Same rule as the backup: a recovery with no receipt after 30 minutes was probably dropped. Start over forgets
  // only that pending record. The session, the backup flag and the words are not touched.
  it('calls a pending recovery stuck only after 30 minutes without a receipt, and Start over clears only that record', async () => {
    const record = (ageMs: number) =>
      JSON.stringify({ account: RECOVERED, hash: OP_HASH, hashKind: 'userop', createdAt: Date.now() - ageMs, credentialId: 'cred-new' })
    kit.bundler.waitForUserOperationReceipt.mockRejectedValue(new Error('not found'))
    localStorage.setItem(pendingKey, record(29 * 60_000))
    expect(await checkPendingRecovery(RECOVERED)).toEqual({ status: 'pending', account: RECOVERED })
    localStorage.setItem(pendingKey, record(31 * 60_000))
    expect(await checkPendingRecovery(RECOVERED)).toEqual({ status: 'stuck', account: RECOVERED })
    expect(readPendingRecovery(RECOVERED)).not.toBeNull()

    savePasskeySession({ address: ACCOUNT.address, credentialId: 'cred-other' })
    markBackupSaved(RECOVERED)
    discardPendingRecovery(RECOVERED)
    expect(readPendingRecovery(RECOVERED)).toBeNull()
    expect(readPasskeySession()).toEqual({ address: ACCOUNT.address, credentialId: 'cred-other' })
    expect(localStorage.getItem('fundit.backup.0x00000000000000000000000000000000000000ab')).toBe('1')
  })

  // "If your recovery already went through, starting over is safe: we will find it." The earlier passkey is an
  // owner on chain when it did, so the account is opened with it: no second passkey, no second recovery.
  describe('after Start over', () => {
    // x = 1, y = 2, as a 64-byte public key (Circle serializes it without the 0x04 prefix).
    const EARLIER = { id: 'cred-earlier', publicKey: `0x${'0'.repeat(63)}1${'0'.repeat(63)}2`, raw: {} }
    const passkeyOwner = (x: bigint, y: bigint) => ({ weight: 1n, credType: 0, addr: '0x0000000000000000000000000000000000000000', publicKeyX: x, publicKeyY: y })

    async function stuckThenStartOver() {
      kit.sdk.toWebAuthnCredential.mockResolvedValueOnce(EARLIER)
      kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({ status: 'pending', account: RECOVERED })
      discardPendingRecovery(RECOVERED)
      code.set(RECOVERED.toLowerCase(), '0x6001')
    }
    afterEach(() => {
      code.clear()
      owners.ids = []
      owners.data = []
      owners.fail = false
      owners.reads = []
    })

    // Some authenticators give the key with its 0x04 prefix (65 bytes). It must match the same owner.
    it('finds an earlier recovery whose public key has the 0x04 prefix', async () => {
      kit.sdk.toWebAuthnCredential.mockResolvedValueOnce({ ...EARLIER, publicKey: `0x04${EARLIER.publicKey.slice(2)}` })
      kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
      await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })
      discardPendingRecovery(RECOVERED)
      code.set(RECOVERED.toLowerCase(), '0x6001')
      owners.data = [passkeyOwner(9n, 9n), passkeyOwner(1n, 2n)]
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({
        status: 'recovered',
        session: { address: RECOVERED, credentialId: 'cred-earlier' },
      })
      expect(kit.executeRecovery).toHaveBeenCalledTimes(1)
    })

    // Starting over twice must still find the first attempt if that is the one that landed late.
    it('finds the first earlier recovery after two Start overs', async () => {
      await stuckThenStartOver()
      kit.sdk.toWebAuthnCredential.mockResolvedValueOnce({ id: 'cred-second', publicKey: `0x${'0'.repeat(63)}3${'0'.repeat(63)}4`, raw: {} })
      kit.bundler.waitForUserOperationReceipt.mockRejectedValueOnce(new Error('slow'))
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({ status: 'pending', account: RECOVERED })
      discardPendingRecovery(RECOVERED)
      owners.data = [passkeyOwner(9n, 9n), passkeyOwner(1n, 2n)]
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({
        status: 'recovered',
        session: { address: RECOVERED, credentialId: 'cred-earlier' },
      })
      expect(kit.executeRecovery).toHaveBeenCalledTimes(2)
      expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(2)
    })

    it('finds an earlier recovery that went through, before making a new passkey', async () => {
      await stuckThenStartOver()
      owners.ids = [`0x${'95'.repeat(30)}`, `0x${'00'.repeat(10)}${'ee'.repeat(20)}`, `0x${'77'.repeat(30)}`]
      owners.data = [passkeyOwner(9n, 9n), { ...passkeyOwner(0n, 0n), credType: 1 }, passkeyOwner(1n, 2n)]
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({
        status: 'recovered',
        session: { address: RECOVERED, credentialId: 'cred-earlier' },
      })
      expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(1)
      expect(kit.executeRecovery).toHaveBeenCalledTimes(1)
      expect(readPasskeySession()).toEqual({ address: RECOVERED, credentialId: 'cred-earlier' })
    })

    it('starts a new recovery when the earlier one did not land', async () => {
      await stuckThenStartOver()
      owners.ids = [`0x${'95'.repeat(30)}`]
      owners.data = [passkeyOwner(9n, 9n)]
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toEqual({
        status: 'recovered',
        session: { address: RECOVERED, credentialId: 'cred-new' },
      })
      expect(kit.sdk.toWebAuthnCredential).toHaveBeenCalledTimes(2)
      expect(kit.executeRecovery).toHaveBeenCalledTimes(2)
    })

    // The check only saves a second recovery. If it cannot read the chain, recovering again is still safe.
    it('starts a new recovery when the owners cannot be read', async () => {
      await stuckThenStartOver()
      owners.fail = true
      expect(await recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).toMatchObject({ status: 'recovered' })
      expect(kit.executeRecovery).toHaveBeenCalledTimes(2)
    })
  })

  it('clears a recovery that reverted, so the person can try again', async () => {
    kit.bundler.waitForUserOperationReceipt.mockResolvedValue(receipt(false))
    await expect(recoverWithPhrase({ phrase: PHRASE, username: 'ana' })).rejects.toThrow('The recovery did not go through.')
    expect(readPendingRecovery(RECOVERED)).toBeNull()
    expect(readPasskeySession()).toBeNull()
  })
})

// What a Fundit account keeps back before it spends: the EntryPoint prefund, not a fixed 0.05 USDC. On Arc
// testnet a Max send that kept 0.05 reverted ("transfer amount exceeds balance") because the prefund was
// about 0.22 USDC, and the person still paid the fee.
describe('passkeyReserve', () => {
  const ADDRESS = getAddress('0x00000000000000000000000000000000000000cc') as Address
  const SEND: Call = { to: '0x3600000000000000000000000000000000000000', data: '0xa9059cbb' }

  beforeEach(() => {
    deposit.value = 0n
    kit.bundler.estimateUserOperationGas.mockReset()
    kit.bundler.estimateUserOperationGas.mockResolvedValue(GAS)
  })
  afterEach(() => {
    code.clear()
    localStorage.clear()
  })

  it('is all gas limits as sent times the max fee, plus the margin, rounded up to the cent', () => {
    // (125,003 + 70,000 + 50,000) gas x 1,000 gwei = 0.245003 USDC, x 1.25 = 0.30625, up to 0.31.
    expect(reserveFor(GAS, 1_000_000_000_000n, 0n)).toBe(310_000n)
  })

  it('counts the EntryPoint deposit, which pays first', () => {
    expect(reserveFor(GAS, 1_000_000_000_000n, 200_000n * 10n ** 12n)).toBe(110_000n)
  })

  it('checks the prefund at the fee now, with no fee margin, right before a send', () => {
    // 0.245003 USDC, up to 0.25.
    expect(reserveFor(GAS, 1_000_000_000_000n, 0n, false)).toBe(250_000n)
  })

  it('never keeps less than the 0.05 USDC floor', () => {
    expect(reserveFor(GAS, 1_000_000_000_000n, 10n ** 18n)).toBe(50_000n)
    expect(reserveFor(GAS, 1n, 0n)).toBe(50_000n)
  })

  it("estimates the caller's calls with this page's signer and Circle's fee, with no passkey prompt", async () => {
    await loginPasskey()
    kit.sdk.toWebAuthnCredential.mockClear()
    expect(await passkeyReserve(ADDRESS, [SEND])).toBe(310_000n)
    expect(kit.bundler.estimateUserOperationGas).toHaveBeenCalledWith({ account: { address: ADDRESS }, calls: [SEND] })
    expect(kit.sdk.toWebAuthnCredential).not.toHaveBeenCalled()
  })

  // A zero transfer to the account itself estimated far below a real send on Arc testnet.
  it('estimates a real 1-unit USDC transfer to another address when the caller gives no calls', async () => {
    await loginPasskey()
    await passkeyReserve(ADDRESS)
    const [{ calls }] = kit.bundler.estimateUserOperationGas.mock.calls.at(-1)! as unknown as [{ calls: Call[] }]
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe('0x3600000000000000000000000000000000000000')
    const { args } = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })
    expect(args).toEqual(['0x000000000000000000000000000000000000dEaD', 1n])
  })

  it('keeps the deployed-account fallback with no signer on this page', async () => {
    code.set(ADDRESS.toLowerCase(), '0x6001')
    expect(await passkeyReserve(ADDRESS, [SEND])).toBe(RESERVE_FALLBACK)
    expect(kit.bundler.estimateUserOperationGas).not.toHaveBeenCalled()
  })

  it('keeps more before the account is deployed, since its first operation deploys it', async () => {
    expect(await passkeyReserve(ADDRESS)).toBe(RESERVE_FALLBACK_NEW_ACCOUNT)
  })

  it('falls back when the estimate fails, less the deposit', async () => {
    await loginPasskey()
    code.set(ADDRESS.toLowerCase(), '0x6001')
    kit.bundler.estimateUserOperationGas.mockRejectedValue(new Error("AA21 didn't pay prefund"))
    deposit.value = 100_000n * 10n ** 12n
    expect(await passkeyReserve(ADDRESS, [SEND])).toBe(RESERVE_FALLBACK - 100_000n)
  })
})

// Circle's bundler sets no fee of its own: the app picks the tier. low is the cheapest Circle suggests. A fee at
// Arc's own price was accepted but never mined on testnet, so nothing below Circle's tiers is used.
describe('user operation fees', () => {
  afterEach(() => clearPasskeySession())

  it("uses Circle's low tier", async () => {
    kit.createBundlerClient.mockClear()
    kit.sdk.getUserOperationGasPrice.mockResolvedValueOnce({
      low: { maxFeePerGas: '723580000000', maxPriorityFeePerGas: '683580000000' },
      medium: { maxFeePerGas: '731380000000', maxPriorityFeePerGas: '691380000000' },
      high: { maxFeePerGas: '731380000000', maxPriorityFeePerGas: '691380000000' },
    })
    await loginPasskey()
    const sending = kit.createBundlerClient.mock.calls
      .map((c) => (c as unknown as [{ userOperation?: { estimateFeesPerGas?: () => Promise<unknown> } }])[0])
      .find((o) => o.userOperation?.estimateFeesPerGas)!
    expect(await sending.userOperation!.estimateFeesPerGas!()).toEqual({ maxFeePerGas: 723_580_000_000n, maxPriorityFeePerGas: 683_580_000_000n })
  })
})
