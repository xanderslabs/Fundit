import { useSyncExternalStore } from 'react'
import { type Address, type Hex, isAddress, type TransactionReceipt, type Transport } from 'viem'
import { arc } from 'viem/chains'
import { erc20Abi } from '../abi/erc20'
import { CIRCLE_CLIENT_KEY, MODULAR_WALLETS_URL, PASSKEY_GAS_BUFFER, PASSKEYS_ENABLED, TOKENS, TX_TIMEOUT_MS } from '../config'
import { arcClient } from './clients'
import { formatAmount } from './format'
import { isUserRejection, PlainError } from './errors'
import { type Call, REVERTED, type Sender, type TxResult, withGasMargin, withTimeout } from './sender'

// Circle Modular Wallets. The SDK is large and only passkey users need it, so it loads with import() on
// first use. The WebAuthn rpId comes from Circle and is bound to the client key's domain (fundit.fun, or
// localhost in development).
const CLIENT_URL = `${MODULAR_WALLETS_URL}/v1/rpc/w3s/buidl`
// The Arc mainnet path is not confirmed yet. probeModularArc checks it.
const ARC_URL = `${CLIENT_URL}/arc`
const ARC_CHAIN_HEX = '0x13b2'

// Only the address and credential id are kept. Storage can throw (private windows, blocked site data),
// so every access is wrapped; without storage the person just logs in again.
const KEY = 'fundit.passkey'
export const PASSKEY_EVENT = 'fundit:passkey'

export type PasskeySession = { address: Address; username?: string }
export type StoredPasskey = { address: Address; credentialId: string }

export function readPasskeySession(): StoredPasskey | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    const x = parsed as Partial<StoredPasskey> | null
    if (!x || typeof x.address !== 'string' || !isAddress(x.address) || typeof x.credentialId !== 'string' || x.credentialId === '') return null
    return { address: x.address, credentialId: x.credentialId }
  } catch {
    return null
  }
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PASSKEY_EVENT))
}

export function savePasskeySession(s: StoredPasskey) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ address: s.address, credentialId: s.credentialId }))
  } catch {
    // Storage is unavailable. The session lasts until the page closes.
  }
  notify()
}

export function clearPasskeySession() {
  live = null
  liveSession = null
  newAccount = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored to clear.
  }
  notify()
}

// useSyncExternalStore needs the same object back while nothing changed, so the parsed value is cached by its text.
let snapshot: { raw: string | null; value: StoredPasskey | null } = { raw: null, value: null }
function getSnapshot(): StoredPasskey | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    // No storage: the session from this page load, if any, lasts until the page closes.
    return liveSession
  }
  if (raw !== snapshot.raw) snapshot = { raw, value: readPasskeySession() }
  return snapshot.value
}

function subscribe(onChange: () => void) {
  window.addEventListener(PASSKEY_EVENT, onChange)
  // Another tab logged in or out.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(PASSKEY_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

const none = () => null

// The current passkey session, or null. Always null when passkeys are switched off.
export function usePasskeySession(): StoredPasskey | null {
  return useSyncExternalStore(PASSKEYS_ENABLED ? subscribe : () => () => {}, PASSKEYS_ENABLED ? getSnapshot : none, none)
}

// The two bundler actions the sender uses. Kept this narrow so tests need no SDK.
export type UserOperationResult = { success: boolean; receipt: TransactionReceipt }
export type ReceiptBundler = {
  waitForUserOperationReceipt(args: { hash: Hex; timeout?: number }): Promise<UserOperationResult>
}
export type UserOperationGas = { callGasLimit: bigint; preVerificationGas: bigint; verificationGasLimit: bigint }
export type PasskeyBundler<A> = ReceiptBundler & {
  estimateUserOperationGas(args: { account: A; calls: Call[] }): Promise<UserOperationGas>
  sendUserOperation(args: { account: A; calls: Call[] } & UserOperationGas): Promise<Hex>
}

// Waits for a user operation, never longer than TX_TIMEOUT_MS, and maps it to a TxResult. Once mined, the
// result carries the real transaction hash. Until then only the user operation hash is known.
export async function userOperationResult(bundler: ReceiptBundler, hash: Hex): Promise<TxResult> {
  const unknown: TxResult = { status: 'timeout', hash, completed: 0, hashKind: 'userop' }
  let res: UserOperationResult | 'timeout'
  try {
    res = await withTimeout(bundler.waitForUserOperationReceipt({ hash, timeout: TX_TIMEOUT_MS }), TX_TIMEOUT_MS)
  } catch {
    // The operation was accepted, so it may still be mined. Reporting failure could make the person pay twice.
    return unknown
  }
  if (res === 'timeout') return unknown
  const txHash = res.receipt.transactionHash
  if (res.success) return { status: 'success', hash: txHash, receipt: res.receipt }
  return { status: 'reverted', hash: txHash, error: REVERTED, completed: 0 }
}

// All calls go in one user operation, so they succeed or fail together. There is no paymaster: the account
// pays its gas in USDC on Arc. completed is always 0 on failure, because nothing in the batch went through.
export function passkeySender<A extends { address: Address }>(account: A, bundler: PasskeyBundler<A>): Sender {
  return {
    kind: 'passkey',
    address: account.address,
    async send(calls, opts) {
      if (calls.length === 0) throw new Error('No calls to send')
      const ops = calls.map((c) => ({ to: c.to, data: c.data }))
      let hash: Hex
      try {
        // The call gas gets the same margin as wallet transactions (see withGasMargin). Passing all three limits
        // stops viem from estimating a second time.
        const gas = await bundler.estimateUserOperationGas({ account, calls: ops })
        hash = await bundler.sendUserOperation({
          account,
          calls: ops,
          callGasLimit: withGasMargin(gas.callGasLimit),
          preVerificationGas: gas.preVerificationGas,
          verificationGasLimit: gas.verificationGasLimit,
        })
      } catch (err) {
        if (isUserRejection(err)) return { status: 'rejected', completed: 0 }
        throw err
      }
      opts?.onHash?.(hash, calls.length - 1)
      return userOperationResult(bundler, hash)
    },
    recheck: (hash) => userOperationResult(bundler, hash),
  }
}

type Live = { credentialId: string; account: { address: Address }; bundler: PasskeyBundler<{ address: Address }> }
// The signing account for this page load. It is never stored; after a reload the person logs in again.
let live: Live | null = null
// The same session as live, as the store shape. getSnapshot falls back to it when storage throws.
let liveSession: StoredPasskey | null = null

function clientKey(): string {
  if (!PASSKEYS_ENABLED || CIRCLE_CLIENT_KEY === '') throw new Error('Passkey wallets are not set up on this site yet.')
  return CIRCLE_CLIENT_KEY
}

async function loadSdk() {
  const kit = await import('./passkeyKit')
  return { sdk: kit.sdk, aa: kit, viem: kit }
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>
type Credential = Awaited<ReturnType<Sdk['sdk']['toWebAuthnCredential']>>

function clients({ sdk, viem }: Sdk, key: string) {
  // The SDK pins its own viem (2.55.11), so its types differ from ours though the objects are the same.
  const transport = sdk.toModularTransport(ARC_URL, key) as unknown as Transport
  const client = viem.createPublicClient({ chain: arc, transport })
  return { transport, client }
}

// A bundler with no account, for reading user operation receipts. It needs no passkey.
let receiptBundler: Promise<ReceiptBundler> | null = null
function readBundler(): Promise<ReceiptBundler> {
  if (!receiptBundler) {
    const key = clientKey()
    receiptBundler = loadSdk().then((lib) => {
      const { transport } = clients(lib, key)
      return lib.aa.createBundlerClient({ chain: arc, transport }) as unknown as ReceiptBundler
    })
    // A failed load must not stick.
    receiptBundler.catch(() => {
      receiptBundler = null
    })
  }
  return receiptBundler
}

async function connect(lib: Sdk, credential: Credential, key: string): Promise<Live> {
  const { sdk, aa } = lib
  const { transport, client } = clients(lib, key)
  type Params = Parameters<typeof sdk.toCircleSmartAccount>[0]
  const account = await sdk.toCircleSmartAccount({
    client: client as unknown as Params['client'],
    owner: aa.toWebAuthnAccount({ credential: credential as never }) as unknown as Params['owner'],
  })
  const bundler = aa.createBundlerClient({
    chain: arc,
    transport,
    userOperation: {
      // Circle's own gas price for its bundler, which respects Arc's fee floor.
      async estimateFeesPerGas() {
        const { medium } = await sdk.getUserOperationGasPrice(client as never)
        return { maxFeePerGas: BigInt(medium.maxFeePerGas), maxPriorityFeePerGas: BigInt(medium.maxPriorityFeePerGas) }
      },
    },
  })
  return {
    credentialId: credential.id,
    account,
    bundler: bundler as unknown as PasskeyBundler<{ address: Address }>,
  }
}

async function credentialFor(mode: 'Register' | 'Login', opts: { username?: string; credentialId?: string }): Promise<Live> {
  const key = clientKey()
  const lib = await loadSdk()
  const credential = await lib.sdk.toWebAuthnCredential({
    transport: lib.sdk.toPasskeyTransport(CLIENT_URL, key),
    mode: mode === 'Register' ? lib.sdk.WebAuthnMode.Register : lib.sdk.WebAuthnMode.Login,
    ...opts,
  })
  return connect(lib, credential, key)
}

function setLive(next: Live) {
  live = next
  liveSession = { address: next.account.address, credentialId: next.credentialId }
}

function start(next: Live) {
  setLive(next)
  savePasskeySession({ address: next.account.address, credentialId: next.credentialId })
}

// Creates a new passkey on this device and the smart account it owns on Arc. If this fails after the browser
// saved the passkey, loginPasskey with that passkey opens the same account.
export async function registerPasskey(username: string): Promise<PasskeySession> {
  start(await credentialFor('Register', { username }))
  newAccount = live!.account.address.toLowerCase()
  notify()
  return { address: live!.account.address, username }
}

// Logs in with a passkey already on this device. The browser lists the passkeys saved for this site.
export async function loginPasskey(): Promise<PasskeySession> {
  start(await credentialFor('Login', {}))
  return { address: live!.account.address }
}

export function logoutPasskey() {
  clearPasskeySession()
}

// The signing account for the stored session. After a reload this asks for the same passkey once.
async function ensureLive(stored: StoredPasskey): Promise<Live> {
  if (live && live.credentialId === stored.credentialId) return live
  const next = await credentialFor('Login', { credentialId: stored.credentialId })
  // Never sign for a wallet other than the one the page shows.
  if (next.account.address.toLowerCase() !== stored.address.toLowerCase()) {
    throw new Error('That passkey opens a different wallet. Sign out and sign in again.')
  }
  setLive(next)
  return next
}

// The Sender for a stored session. It loads the SDK and the account only when something is sent.
export function storedPasskeySender(stored: StoredPasskey): Sender {
  return {
    kind: 'passkey',
    address: stored.address,
    async send(calls, opts) {
      const { account, bundler } = await ensureLive(stored)
      return passkeySender(account, bundler).send(calls, opts)
    },
    // Reading a receipt needs no signature, so this never asks for the passkey.
    recheck: async (hash) => userOperationResult(await readBundler(), hash),
  }
}

// Account safety. Losing every passkey loses the account, so a new account is asked to add a recovery key
// (Circle's recovery support: the key's address becomes an extra owner of the account). The app cannot read
// that back from Circle, so "saved" is remembered per account in this browser.
const BACKUP_KEY = 'fundit.backup.'
// The account created on this page load, until the person picks Later. Never stored.
let newAccount: string | null = null
// Accounts marked saved on this page load, for when storage throws.
const savedThisLoad = new Set<string>()

function backupSaved(address: Address): boolean {
  const a = address.toLowerCase()
  try {
    return localStorage.getItem(BACKUP_KEY + a) === '1' || savedThisLoad.has(a)
  } catch {
    return savedThisLoad.has(a)
  }
}

// The person confirmed they wrote the recovery key down.
export function markBackupSaved(address: Address) {
  const a = address.toLowerCase()
  savedThisLoad.add(a)
  try {
    localStorage.setItem(BACKUP_KEY + a, '1')
  } catch {
    // Storage is unavailable. My page asks again after a reload.
  }
  notify()
}

// Later: the prompt after sign-up goes away for this visit. My page keeps asking.
export function dismissBackupPrompt() {
  newAccount = null
  notify()
}

// True while this account has no saved backup in this browser. My page shows the prompt then.
export function useBackupNeeded(stored: StoredPasskey | null): boolean {
  const get = () => stored !== null && !backupSaved(stored.address)
  return useSyncExternalStore(subscribe, get, () => false)
}

// True right after sign-up, until the person adds a backup or picks Later.
export function useBackupPrompt(stored: StoredPasskey | null): boolean {
  const get = () => stored !== null && newAccount === stored.address.toLowerCase() && !backupSaved(stored.address)
  return useSyncExternalStore(subscribe, get, () => false)
}

// 12 words from the browser's secure random source. They are shown to the person once and never stored.
export async function newRecoveryPhrase(): Promise<string> {
  const kit = await import('./passkeyKit')
  return kit.generateMnemonic(kit.english)
}

// Registers the recovery phrase's address as a recovery owner of the account, with Circle's
// registerRecoveryAddress. The account pays the gas in USDC (no paymaster), so it needs the gas buffer first.
export async function addBackupPasskey(stored: StoredPasskey, recoveryPhrase: string): Promise<void> {
  const usdc = await arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [stored.address] })
  if (usdc < PASSKEY_GAS_BUFFER) {
    throw new PlainError(
      `Add at least ${formatAmount(PASSKEY_GAS_BUFFER, 'USDC')} to your Fundit account first. It pays the network fee for the backup.`,
    )
  }
  const { account, bundler } = await ensureLive(stored)
  const kit = await import('./passkeyKit')
  const recovery = kit.mnemonicToAccount(recoveryPhrase)
  type Client = Parameters<typeof kit.sdk.recoveryActions>[0]
  type Params = Parameters<ReturnType<typeof kit.sdk.recoveryActions>['registerRecoveryAddress']>[0]
  let hash: Hex
  try {
    hash = await kit.sdk.recoveryActions(bundler as unknown as Client).registerRecoveryAddress({
      account: account as unknown as Params['account'],
      recoveryAddress: recovery.address,
    } as Params)
  } catch (err) {
    if (isUserRejection(err)) throw new PlainError('You cancelled the request. No backup was added.')
    throw err
  }
  const res = await userOperationResult(bundler, hash)
  if (res.status === 'timeout') throw new PlainError('The backup is taking a while to confirm. Try again in a minute.')
  if (res.status !== 'success') throw new PlainError('The backup did not go through. Nothing was added. Try again.')
}

// True when Circle's Arc mainnet endpoint answers with Arc's chain id. Run by hand once a client key exists.
export async function probeModularArc(): Promise<boolean> {
  const { sdk } = await loadSdk()
  const transport = sdk.toModularTransport(ARC_URL, clientKey())({ chain: undefined })
  const id = await transport.request({ method: 'eth_chainId' })
  return id === ARC_CHAIN_HEX
}
