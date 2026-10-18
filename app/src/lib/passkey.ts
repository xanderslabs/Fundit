import { useSyncExternalStore } from 'react'
import { type Address, decodeErrorResult, getAddress, type Hex, isAddress, numberToHex, parseAbi, type TransactionReceipt, type Transport } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { ARC_CHAIN, CIRCLE_CLIENT_KEY, MODULAR_WALLETS_URL, NETWORK, PASSKEY_GAS_BUFFER, PASSKEYS_ENABLED, TOKENS, TX_TIMEOUT_MS } from '../config'
import { arcClient } from './clients'
import { formatAmount } from './format'
import { isUserRejection, PlainError } from './errors'
import { type Call, REVERTED, type Sender, type TxResult, withGasMargin, withTimeout } from './sender'

// Circle Modular Wallets. The SDK is large and only passkey users need it, so it loads with import() on
// first use. The WebAuthn rpId comes from Circle and is bound to the client key's domain (fundit.fun, or
// localhost in development).
const CLIENT_URL = `${MODULAR_WALLETS_URL}/v1/rpc/w3s/buidl`
// /arc on mainnet (not confirmed yet) and /arcTestnet on testnet (from Circle's guide). probeModularArc checks it.
const ARC_URL = `${CLIENT_URL}${NETWORK.modularChainPath}`
const ARC_CHAIN_HEX = numberToHex(ARC_CHAIN.id)

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
  if (!PASSKEYS_ENABLED || CIRCLE_CLIENT_KEY === '') throw new Error('Fundit accounts are not set up on this site yet.')
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
  const client = viem.createPublicClient({ chain: ARC_CHAIN, transport })
  return { transport, client }
}

// A bundler with no account, for reading user operation receipts. It needs no passkey.
let receiptBundler: Promise<ReceiptBundler> | null = null
function readBundler(): Promise<ReceiptBundler> {
  if (!receiptBundler) {
    const key = clientKey()
    receiptBundler = loadSdk().then((lib) => {
      const { transport } = clients(lib, key)
      return lib.aa.createBundlerClient({ chain: ARC_CHAIN, transport }) as unknown as ReceiptBundler
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
  return {
    credentialId: credential.id,
    account,
    bundler: sendingBundler(lib, transport, client) as unknown as PasskeyBundler<{ address: Address }>,
  }
}

function sendingBundler({ sdk, aa }: Sdk, transport: Transport, client: ReturnType<typeof clients>['client']) {
  return aa.createBundlerClient({
    chain: ARC_CHAIN,
    transport,
    userOperation: {
      // Circle's own gas price for its bundler, which respects Arc's fee floor.
      async estimateFeesPerGas() {
        const { medium } = await sdk.getUserOperationGasPrice(client as never)
        return { maxFeePerGas: BigInt(medium.maxFeePerGas), maxPriorityFeePerGas: BigInt(medium.maxPriorityFeePerGas) }
      },
    },
  })
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
// A backup user operation that was sent but not confirmed yet. Only the account and the hash, never the words.
const PENDING_KEY = 'fundit.backup.pending.'
// The account created on this page load, until the person picks Later. Never stored.
let newAccount: string | null = null
// Accounts marked saved on this page load, for when storage throws.
const savedThisLoad = new Set<string>()

export type PendingBackup = { account: Address; hash: Hex; hashKind: 'userop'; createdAt: number }
// A pending backup with no receipt after this long was probably dropped, so the person may start over.
export const BACKUP_STUCK_MS = 30 * 60 * 1000
// Same as bridge.ts: older records are dropped on read.
const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function backupSaved(address: Address): boolean {
  const a = address.toLowerCase()
  try {
    return localStorage.getItem(BACKUP_KEY + a) === '1'
  } catch {
    return savedThisLoad.has(a)
  }
}

// The recovery key is on the account.
export function markBackupSaved(address: Address) {
  const a = address.toLowerCase()
  try {
    localStorage.setItem(BACKUP_KEY + a, '1')
  } catch {
    // Storage is unavailable. My page asks again after a reload.
    savedThisLoad.add(a)
  }
  notify()
}

export function readPendingBackup(address: Address): PendingBackup | null {
  const key = PENDING_KEY + address.toLowerCase()
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<PendingBackup> | null
    if (!x || typeof x.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(x.hash) || typeof x.account !== 'string') return null
    if (typeof x.createdAt !== 'number' || x.createdAt <= Date.now() - BACKUP_MAX_AGE_MS) {
      // No notify here: this runs inside a store snapshot read.
      localStorage.removeItem(key)
      return null
    }
    return { account: x.account, hash: x.hash, hashKind: 'userop', createdAt: x.createdAt }
  } catch {
    return null
  }
}

function savePendingBackup(p: PendingBackup) {
  try {
    localStorage.setItem(PENDING_KEY + p.account.toLowerCase(), JSON.stringify(p))
  } catch {
    // Without storage the pending backup is only known while the words are on screen.
  }
  notify()
}

// Start over: forget a backup that never confirmed, so a new one can begin.
export function discardPendingBackup(address: Address) {
  clearPendingBackup(address)
}

function clearPendingBackup(address: Address) {
  try {
    localStorage.removeItem(PENDING_KEY + address.toLowerCase())
  } catch {
    // Nothing stored to clear.
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

// True while a sent backup has not confirmed. No new backup starts until it does.
export function useBackupPending(stored: StoredPasskey | null): boolean {
  const get = () => stored !== null && readPendingBackup(stored.address) !== null
  return useSyncExternalStore(subscribe, get, () => false)
}

// 12 words from the browser's secure random source. They live only in the backup dialog's memory.
export async function newRecoveryPhrase(): Promise<string> {
  const kit = await import('./passkeyKit')
  return kit.generateMnemonic(kit.english)
}

// True when the account holds enough USDC to pay the backup's network fee.
export async function canPayBackupGas(address: Address): Promise<boolean> {
  const usdc = await arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
  return usdc >= PASSKEY_GAS_BUFFER
}

// The weighted multisig plugin reverts addOwners for an address that is already an owner with
// InvalidOwner(bytes30) (BaseWeightedMultisigPlugin._addOwners in circlefin/buidl-wallet-contracts). The owner
// id is AddressBytesLib.toBytes30: bytes30(uint240(uint160(addr))), so the address is its low 20 bytes. Only
// an id for this recovery address means an earlier backup already landed.
const invalidOwnerAbi = parseAbi(['error InvalidOwner(bytes30 ownerId)'])
const INVALID_OWNER = /0xb7ed090c[0-9a-f]{64}/i
export function isAlreadyOwner(e: unknown, recoveryAddress: Address): boolean {
  let cur = e
  for (let i = 0; cur && typeof cur === 'object' && i < 20; i++) {
    const x = cur as { message?: unknown; details?: unknown; data?: unknown; cause?: unknown }
    const data = typeof x.data === 'object' && x.data !== null ? (x.data as { data?: unknown }).data : x.data
    for (const v of [x.message, x.details, data]) {
      const hex = typeof v === 'string' ? INVALID_OWNER.exec(v)?.[0] : undefined
      if (!hex) continue
      try {
        const [ownerId] = decodeErrorResult({ abi: invalidOwnerAbi, data: hex as Hex }).args
        if (`0x${ownerId.slice(-40)}`.toLowerCase() === recoveryAddress.toLowerCase()) return true
      } catch {
        // Not decodable. Keep looking.
      }
    }
    cur = x.cause
  }
  return false
}

export type BackupStatus = 'added' | 'pending'

// Registers the recovery phrase's address as an owner of the account, with Circle's registerRecoveryAddress.
// The account pays the gas in USDC (no paymaster). 'pending' means the operation was sent but not confirmed in
// time: it is saved, and checkPendingBackup finds out later. Only the derived address leaves the browser.
export async function addBackupPasskey(stored: StoredPasskey, recoveryPhrase: string): Promise<BackupStatus> {
  if (readPendingBackup(stored.address)) {
    throw new PlainError('Your last backup is still confirming. Check it before you start a new one.')
  }
  if (!(await canPayBackupGas(stored.address))) {
    throw new PlainError(
      `Add at least ${formatAmount(PASSKEY_GAS_BUFFER, 'USDC')} to your Fundit account first. It pays the network fee for the backup.`,
    )
  }
  const { account, bundler } = await ensureLive(stored)
  const kit = await import('./passkeyKit')
  const recoveryAddress = kit.mnemonicToAccount(recoveryPhrase).address
  type Client = Parameters<typeof kit.sdk.recoveryActions>[0]
  type Params = Parameters<ReturnType<typeof kit.sdk.recoveryActions>['registerRecoveryAddress']>[0]
  const actions = kit.sdk.recoveryActions(bundler as unknown as Client)
  const owner = account as unknown as Params['account']
  let hash: Hex
  try {
    // Same margin on the call gas as every other send (see withGasMargin).
    const gas = await actions.estimateRegisterRecoveryAddressGas({ account: owner, recoveryAddress } as Params)
    hash = await actions.registerRecoveryAddress({
      account: owner,
      recoveryAddress,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
    } as Params)
  } catch (err) {
    if (isAlreadyOwner(err, recoveryAddress)) {
      markBackupSaved(stored.address)
      return 'added'
    }
    if (isUserRejection(err)) throw new PlainError('You cancelled the request. No backup was added.')
    throw err
  }
  savePendingBackup({ account: stored.address, hash, hashKind: 'userop', createdAt: Date.now() })
  return settleBackup(stored.address, await userOperationResult(bundler, hash))
}

function settleBackup(address: Address, res: TxResult): BackupStatus {
  if (res.status === 'timeout') return 'pending'
  clearPendingBackup(address)
  if (res.status !== 'success') throw new PlainError('The backup did not go through. Nothing was added. Try again.')
  markBackupSaved(address)
  return 'added'
}

// Checks a pending backup with the passkey sender's recheck. It never sends anything again. 'stuck' is a
// pending backup still without a receipt after BACKUP_STUCK_MS: the person may start over.
export async function checkPendingBackup(stored: StoredPasskey): Promise<BackupStatus | 'stuck' | 'none'> {
  const pending = readPendingBackup(stored.address)
  if (!pending) return backupSaved(stored.address) ? 'added' : 'none'
  const status = settleBackup(stored.address, await storedPasskeySender(stored).recheck!(pending.hash))
  return status === 'pending' && Date.now() - pending.createdAt > BACKUP_STUCK_MS ? 'stuck' : status
}

// Recovery with the recovery key. The words stay in memory: they are never stored, logged or sent. Only the
// key's address, the account address, the new passkey and signatures go out.
const RECOVERY_PENDING_KEY = 'fundit.recovery.pending.'
const INVALID_PHRASE = "Those words don't form a valid recovery key. Check the order and spelling."

export type PendingRecovery = { account: Address; hash: Hex; hashKind: 'userop'; createdAt: number; credentialId: string }
export type RecoveryResult = { status: 'recovered'; session: StoredPasskey } | { status: 'pending'; account: Address }

// The account cannot pay the recovery's network fee yet. The page shows its address so it can be funded.
export class RecoveryNeedsFunds extends PlainError {
  constructor(readonly account: Address) {
    super(`Recovery needs a small network fee. Send at least ${formatAmount(PASSKEY_GAS_BUFFER, 'USDC')} on Arc to your account address first.`)
  }
}

// Lower case, single spaces. The words feed a key derivation, so stray spaces or capitals would give a
// different key.
export function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).join(' ')
}

// True for exactly 12 words that form a valid BIP-39 English phrase (words and checksum), checked by @scure/bip39.
export async function isValidRecoveryPhrase(text: string): Promise<boolean> {
  const phrase = normalizePhrase(text)
  if (phrase.split(' ').length !== 12) return false
  const kit = await import('./passkeyKit')
  return kit.validateMnemonic(phrase, kit.bip39English)
}

export function readPendingRecovery(account: Address): PendingRecovery | null {
  const key = RECOVERY_PENDING_KEY + account.toLowerCase()
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<PendingRecovery> | null
    if (!x || typeof x.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(x.hash) || typeof x.account !== 'string' || !isAddress(x.account)) return null
    if (typeof x.credentialId !== 'string' || x.credentialId === '') return null
    if (typeof x.createdAt !== 'number' || x.createdAt <= Date.now() - BACKUP_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    return { account: x.account, hash: x.hash, hashKind: 'userop', createdAt: x.createdAt, credentialId: x.credentialId }
  } catch {
    return null
  }
}

function savePendingRecovery(p: PendingRecovery) {
  try {
    localStorage.setItem(RECOVERY_PENDING_KEY + p.account.toLowerCase(), JSON.stringify(p))
  } catch {
    // Without storage the pending recovery is only known while the page is open.
  }
}

function clearPendingRecovery(account: Address) {
  try {
    localStorage.removeItem(RECOVERY_PENDING_KEY + account.toLowerCase())
  } catch {
    // Nothing stored to clear.
  }
}

// The new passkey owns the account now. The old recovery key may be exposed, so the backup flag is cleared and
// My page asks for a new key. The signing account loads on the next send, with the new passkey.
function finishRecovery(account: Address, credentialId: string): RecoveryResult {
  clearPendingRecovery(account)
  savedThisLoad.delete(account.toLowerCase())
  try {
    localStorage.removeItem(BACKUP_KEY + account.toLowerCase())
  } catch {
    // Nothing stored to clear.
  }
  const session = { address: account, credentialId }
  live = null
  liveSession = session
  savePasskeySession(session)
  return { status: 'recovered', session }
}

function settleRecovery(pending: PendingRecovery, res: TxResult): RecoveryResult {
  if (res.status === 'timeout') return { status: 'pending', account: pending.account }
  clearPendingRecovery(pending.account)
  if (res.status !== 'success') throw new PlainError('The recovery did not go through. Nothing changed. Try again.')
  return finishRecovery(pending.account, pending.credentialId)
}

// Recovers a passkey account with its recovery key, as in Circle's passkey-recovery example:
// 1. the words become a local account (viem mnemonicToAccount), checked first so a typo sends nothing;
// 2. Circle's address mapping (made by registerRecoveryAddress) gives the account that key belongs to;
// 3. the account must hold PASSKEY_GAS_BUFFER, since it pays the fee in USDC (no paymaster);
// 4. a new passkey is registered with the given name;
// 5. executeRecovery, signed by the local account, adds the new passkey as an owner.
// 'pending' means the operation went out but did not confirm in time. It is saved (never the words) and
// checkPendingRecovery finishes it. While it is pending, no second recovery is sent for that account.
export async function recoverWithPhrase(p: { phrase: string; username: string }): Promise<RecoveryResult> {
  const phrase = normalizePhrase(p.phrase)
  if (!(await isValidRecoveryPhrase(phrase))) throw new PlainError(INVALID_PHRASE)
  const username = p.username.trim()
  if (username === '') throw new PlainError('Enter a name for your new passkey.')
  const key = clientKey()
  const lib = await loadSdk()
  const { sdk } = lib
  const recovery = lib.viem.mnemonicToAccount(phrase)
  const { transport, client } = clients(lib, key)

  type Lookup = Parameters<typeof sdk.getAddressMapping>
  const lookup: Lookup[1] = { owner: { type: sdk.OwnerIdentifierType.EOA, identifier: { address: recovery.address } } }
  const mappings = await sdk.getAddressMapping(client as unknown as Lookup[0], lookup)
  let wallets = [...new Set(mappings.map((m) => m.walletAddress.toLowerCase()))].map((w) => getAddress(w))
  if (wallets.length === 0) throw new PlainError("We couldn't find a Fundit account for this recovery key. Check the words and try again.")
  if (wallets.length > 1) {
    // Circle can also hold a wallet made for the key itself. The account that added the key is deployed on Arc.
    const deployed = await Promise.all(wallets.map(async (w) => ((await arcClient.getCode({ address: w })) ?? '0x') !== '0x'))
    wallets = wallets.filter((_, i) => deployed[i])
    if (wallets.length !== 1) throw new PlainError('This recovery key belongs to more than one account, so Fundit cannot pick one.')
  }
  const account = wallets[0]!

  const pending = readPendingRecovery(account)
  if (pending) return { status: 'pending', account }
  if (!(await canPayBackupGas(account))) throw new RecoveryNeedsFunds(account)

  const credential = await sdk.toWebAuthnCredential({
    transport: sdk.toPasskeyTransport(CLIENT_URL, key),
    mode: sdk.WebAuthnMode.Register,
    username,
  })
  type AccountParams = Parameters<typeof sdk.toCircleSmartAccount>[0]
  const smart = await sdk.toCircleSmartAccount({
    client: client as unknown as AccountParams['client'],
    owner: recovery as unknown as AccountParams['owner'],
    address: account,
  })
  const bundler = sendingBundler(lib, transport, client)
  type Client = Parameters<typeof sdk.recoveryActions>[0]
  type Params = Parameters<ReturnType<typeof sdk.recoveryActions>['executeRecovery']>[0]
  const actions = sdk.recoveryActions(bundler as unknown as Client)
  const base = { account: smart, credential } as unknown as Params
  // Same margin on the call gas as every other send (see withGasMargin).
  const gas = await actions.estimateExecuteRecoveryGas(base)
  const hash = await actions.executeRecovery({
    ...base,
    callGasLimit: withGasMargin(gas.callGasLimit),
    preVerificationGas: gas.preVerificationGas,
    verificationGasLimit: gas.verificationGasLimit,
  } as Params)
  const record: PendingRecovery = { account, hash, hashKind: 'userop', createdAt: Date.now(), credentialId: credential.id }
  savePendingRecovery(record)
  return settleRecovery(record, await userOperationResult(bundler as unknown as ReceiptBundler, hash))
}

// Checks a pending recovery with a receipt read. It never sends anything again and needs no passkey.
export async function checkPendingRecovery(account: Address): Promise<RecoveryResult | { status: 'none' }> {
  const pending = readPendingRecovery(account)
  if (!pending) return { status: 'none' }
  return settleRecovery(pending, await userOperationResult(await readBundler(), pending.hash))
}

// True when Circle's Arc endpoint for this network answers with that network's chain id. Run by hand once a client key exists.
export async function probeModularArc(): Promise<boolean> {
  const { sdk } = await loadSdk()
  const transport = sdk.toModularTransport(ARC_URL, clientKey())({ chain: undefined })
  const id = await transport.request({ method: 'eth_chainId' })
  return id === ARC_CHAIN_HEX
}
