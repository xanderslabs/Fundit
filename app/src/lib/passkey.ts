import { useSyncExternalStore } from 'react'
import { type Address, decodeErrorResult, encodeAbiParameters, encodeFunctionData, getAddress, type Hex, isAddress, isHex, keccak256, numberToHex, pad, parseAbi, parseAbiParameters, type TransactionReceipt, type Transport } from 'viem'
import { erc20Abi } from '../abi/erc20'
import {
  ARC_CHAIN,
  CIRCLE_CLIENT_KEY,
  CIRCLE_MSCA_FACTORY,
  CIRCLE_MULTISIG_MANIFEST_HASH,
  CIRCLE_MULTISIG_PLUGIN,
  ENTRY_POINT,
  MODULAR_WALLETS_URL,
  NETWORK,
  PASSKEY_GAS_BUFFER,
  storageKey,
  FALLBACK_GAS_DEPLOYED,
  FALLBACK_GAS_NEW_ACCOUNT,
  TOKENS,
  TX_TIMEOUT_MS,
  WORST_SEEN_FEE,
} from '../config'
import { arcClient } from './clients'
import { formatAmount } from './format'
import { isMissingParams, isPrefundError, isUserRejection, NeedsNetworkFee, PlainError } from './errors'
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
const KEY = storageKey('passkey')
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

// The current passkey session, or null.
export function usePasskeySession(): StoredPasskey | null {
  return useSyncExternalStore(subscribe, getSnapshot, none)
}

// The two bundler actions the sender uses. Kept this narrow so tests need no SDK.
export type UserOperationResult = { success: boolean; receipt: TransactionReceipt }
export type ReceiptBundler = {
  waitForUserOperationReceipt(args: { hash: Hex; timeout?: number }): Promise<UserOperationResult>
}
export type UserOperationGas = { callGasLimit: bigint; preVerificationGas: bigint; verificationGasLimit: bigint }
export type UserOperationFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export type PasskeyBundler<A> = ReceiptBundler & {
  estimateUserOperationGas(args: { account: A; calls: Call[] }): Promise<UserOperationGas>
  sendUserOperation(args: { account: A; calls: Call[] } & UserOperationGas & Partial<UserOperationFees>): Promise<Hex>
}

// What passkeySender reads to check that the account can pay before it sends.
export type PasskeyFunds = {
  // Circle's fee now. The same fee goes into the user operation.
  fees(): Promise<UserOperationFees>
  usdc(): Promise<bigint>
  depositWei(): Promise<bigint>
  // The reserve to name when the bundler cannot estimate because the account is short (see fallbackReserve).
  fallback(): Promise<bigint>
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
// With funds, nothing is sent unless the account holds opts.usdcOut plus the operation's prefund, worked out from
// this estimate and the fee that goes into it. A send that left less would revert in its own calls and still
// pay the fee. The refusal is a NeedsNetworkFee with the real number.
export function passkeySender<A extends { address: Address }>(account: A, bundler: PasskeyBundler<A>, funds?: PasskeyFunds): Sender {
  return {
    kind: 'passkey',
    address: account.address,
    async send(calls, opts) {
      if (calls.length === 0) throw new Error('No calls to send')
      const ops = calls.map((c) => ({ to: c.to, data: c.data }))
      const out = opts?.usdcOut ?? 0n
      const refuseIfShort = async (reserve: bigint) => {
        if ((await funds!.usdc()) < out + reserve) throw new NeedsNetworkFee(reserve)
      }
      let hash: Hex
      try {
        let gas: UserOperationGas
        try {
          gas = await bundler.estimateUserOperationGas({ account, calls: ops })
        } catch (err) {
          // A short account fails the estimate itself. Name the stand-in reserve instead of the bundler's code.
          if (funds && (isPrefundError(err) || isMissingParams(err))) await refuseIfShort(await funds.fallback())
          throw err
        }
        // The call gas gets the same margin as wallet transactions (see withGasMargin). Passing all three limits
        // and the fee stops viem from estimating again, so the fee checked is the fee sent.
        const limits = {
          callGasLimit: withGasMargin(gas.callGasLimit),
          preVerificationGas: gas.preVerificationGas,
          verificationGasLimit: gas.verificationGasLimit,
        }
        let fees: UserOperationFees | undefined
        if (funds) {
          const [now, depositWei] = await Promise.all([funds.fees(), funds.depositWei()])
          await refuseIfShort(reserveFor(gas, now.maxFeePerGas, depositWei, false))
          fees = now
        }
        hash = await bundler.sendUserOperation({ account, calls: ops, ...limits, ...fees })
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

// publicKey is the passkey's, as Circle serializes it: recoverWithPhrase checks it against the account's owners.
type Live = { credentialId: string; publicKey: Hex; account: { address: Address }; bundler: PasskeyBundler<{ address: Address }> }
// The signing account for this page load. It is never stored; after a reload the person logs in again.
let live: Live | null = null
// The same session as live, as the store shape. getSnapshot falls back to it when storage throws.
let liveSession: StoredPasskey | null = null

function clientKey(): string {
  if (CIRCLE_CLIENT_KEY === '') throw new PlainError('Fundit accounts are not set up on this site yet. Try again later.')
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

// Which account a passkey opens. Every passkey has its own account, at an address derived from its public key, and
// that is the account it opens. A passkey added to an existing account by recovery also owns that account, and
// Circle maps the passkey to it (executeRecovery in Circle's SDK writes the mapping, as x and y in decimal:
// dist/index.mjs, executeRecovery). Neither the mapping nor ownership on chain proves the account is this person's:
// anyone can add someone else's public key as an owner of their own account (addOwners needs no signature from that
// key) and map it, and even fund it as a lure. So a passkey opens another account only with proof that the person
// recovered it on this device: the record recoverWithPhrase writes, and only while the passkey still owns that
// account on Arc. Without a record, a mapping to another account only shows a hint to recover on this device too,
// with no address or balance. The record is checked on Arc, never through Circle. A failed Arc read throws
// LOOKUP_FAILED, so it never opens the own account in place of the recovered one.
const LOOKUP_FAILED = "We couldn't check which account this passkey opens. Check your connection and try again."

// Proof of a recovery on this device: credential id to the recovered account. Kept across sign-out; only the address
// is stored.
const RECOVERED_KEY = storageKey('passkey.recovered.')

function readRecovered(credentialId: string): Address | null {
  try {
    const v = localStorage.getItem(RECOVERED_KEY + credentialId)
    return v && isAddress(v) ? v : null
  } catch {
    return null
  }
}

function rememberRecovered(credentialId: string, address: Address) {
  try {
    localStorage.setItem(RECOVERED_KEY + credentialId, address)
  } catch {
    // Storage is unavailable. The passkey opens its own account until the person recovers again here.
  }
}

function forgetRecovered(credentialId: string) {
  try {
    localStorage.removeItem(RECOVERED_KEY + credentialId)
  } catch {
    // Nothing stored to clear.
  }
}

const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase()

// A read for the account check. Any failure becomes LOOKUP_FAILED, so the caller never guesses.
function checked<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    throw new PlainError(LOOKUP_FAILED, { cause: err })
  })
}

// The recovered account this passkey may open on this device, or null. A record whose passkey no longer owns the
// account on Arc is deleted.
// A recovered account is always deployed (saving its recovery key deployed it), so a read with no code is a node
// that could not answer: LOOKUP_FAILED, and the record stays.
async function recoveredAccount(credentialId: string, publicKey: Hex, own: Address): Promise<Address | null> {
  const recorded = readRecovered(credentialId)
  const key = publicKeyXY(publicKey)
  if (!recorded || same(recorded, own) || !key) return null
  const owners = await checked(readOwners(recorded))
  if (!owners) throw new PlainError(LOOKUP_FAILED)
  if (owners.ownersData.some((o) => o.publicKeyX === key.x && o.publicKeyY === key.y)) return recorded
  forgetRecovered(credentialId)
  return null
}

// The passkey's own account, worked out on Arc by Circle's factory from the public key, as toCircleSmartAccount
// does locally (computeAddress in dist/index.mjs): sender keccak256(x, y), a zero salt, and the multisig plugin
// installed with this key alone at weight 1 and threshold 1.
const factoryAbi = parseAbi(['function getAddress(bytes32 sender, bytes32 salt, bytes initializingData) view returns (address addr, bytes32 mixedSalt)'])
async function derivedAddress(publicKey: Hex): Promise<Address> {
  const key = publicKeyXY(publicKey)
  if (!key) throw new PlainError(UNCONFIRMED)
  const sender = keccak256(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [key.x, key.y]))
  const install = encodeAbiParameters(parseAbiParameters('address[], uint256[], (uint256 x, uint256 y)[], uint256[], uint256'), [
    [],
    [],
    [{ x: key.x, y: key.y }],
    [1n],
    1n,
  ])
  const init = encodeAbiParameters(parseAbiParameters('address[], bytes32[], bytes[]'), [[CIRCLE_MULTISIG_PLUGIN], [CIRCLE_MULTISIG_MANIFEST_HASH], [install]])
  const [address] = await arcClient.readContract({ address: CIRCLE_MSCA_FACTORY, abi: factoryAbi, functionName: 'getAddress', args: [sender, pad('0x', { size: 32 }), init] })
  return address
}

const UNCONFIRMED = 'We could not confirm your account. Try again later.'

// The passkey's own account. Circle's SDK takes its address from Circle's API, so it must match the one Circle's
// factory gives on Arc; otherwise nothing opens.
async function connectOwn(lib: Sdk, credential: Credential, key: string): Promise<Live> {
  const [own, derived] = await Promise.all([connect(lib, credential, key), checked(derivedAddress(credential.publicKey))])
  if (!same(own.account.address, derived)) throw new PlainError(UNCONFIRMED)
  return own
}

// Circle answers circle_getAddressMapping for an owner it has no record of with an error (-32602 and this text,
// seen on the live API on 2026-10-19), not an empty list. Only that answer means "no mapping".
const NO_MAPPING = /Cannot find target wallet to identifier map/i
function isNoMapping(e: unknown): boolean {
  let cur = e
  for (let i = 0; cur && typeof cur === 'object' && i < 20; i++) {
    const x = cur as { message?: unknown; details?: unknown; cause?: unknown }
    if ([x.message, x.details].some((v) => typeof v === 'string' && NO_MAPPING.test(v))) return true
    cur = x.cause
  }
  return false
}

type MappingOwner = Parameters<Sdk['sdk']['getAddressMapping']>[1]['owner']
// The accounts Circle maps this owner to, without repeats. Empty when Circle has no mapping. Rejects on any other error.
async function mappedWallets(sdk: Sdk['sdk'], client: unknown, owner: MappingOwner): Promise<Address[]> {
  let mappings: { walletAddress: string }[]
  try {
    mappings = await sdk.getAddressMapping(client as never, { owner })
  } catch (err) {
    if (isNoMapping(err)) return []
    throw err
  }
  return [...new Set(mappings.map((m) => m.walletAddress.toLowerCase()))].map((w) => getAddress(w))
}

// True when Circle maps this passkey to an account other than its own: it was probably added there by a recovery
// on another device. Only used for a hint; the account is never opened from this. A failed lookup only skips the
// hint, so Circle's mapping API being down never blocks a sign-in.
async function mappedElsewhere(lib: Sdk, publicKey: Hex, own: Address): Promise<boolean> {
  const key = publicKeyXY(publicKey)
  if (!key) return false
  const { sdk } = lib
  try {
    const mapped = await mappedWallets(sdk, clients(lib, clientKey()).client, {
      type: sdk.OwnerIdentifierType.WebAuthn,
      identifier: { publicKeyX: key.x.toString(), publicKeyY: key.y.toString() },
    })
    return mapped.some((w) => !same(w, own))
  } catch {
    return false
  }
}

// The smart account for this passkey: its own account, or the named one.
async function connect(lib: Sdk, credential: Credential, key: string, address?: Address): Promise<Live> {
  const { sdk, aa } = lib
  const { transport, client } = clients(lib, key)
  type Params = Parameters<typeof sdk.toCircleSmartAccount>[0]
  const account = await sdk.toCircleSmartAccount({
    client: client as unknown as Params['client'],
    owner: aa.toWebAuthnAccount({ credential: credential as never }) as unknown as Params['owner'],
    ...(address && { address }),
  })
  return {
    credentialId: credential.id,
    publicKey: credential.publicKey,
    account,
    bundler: sendingBundler(lib, transport, client) as unknown as PasskeyBundler<{ address: Address }>,
  }
}

function sendingBundler({ sdk, aa }: Sdk, transport: Transport, client: ReturnType<typeof clients>['client']) {
  return aa.createBundlerClient({
    chain: ARC_CHAIN,
    transport,
    userOperation: {
      estimateFeesPerGas: () => userOperationFees(sdk, client),
    },
  })
}

// Circle's own gas price for its bundler (circle_getUserOperationGasPrice), the low tier. Circle's tiers sit far
// above Arc's own price: on Arc testnet on 2026-10-18, low was 723.58 gwei max and 683.58 gwei priority (medium
// 731.38 and 691.38) against a 20 gwei base fee. A user operation priced at Arc's own fee (base fee plus the
// node's 5 gwei tip) was accepted by the bundler but never mined, so no tier lower than Circle's is used.
async function userOperationFees(sdk: Sdk['sdk'], client: unknown) {
  const { low } = await sdk.getUserOperationGasPrice(client as never)
  return { maxFeePerGas: BigInt(low.maxFeePerGas), maxPriorityFeePerGas: BigInt(low.maxPriorityFeePerGas) }
}

async function credentialFor(mode: 'Register' | 'Login', opts: { username?: string; credentialId?: string }) {
  const key = clientKey()
  const lib = await loadSdk()
  const credential = await lib.sdk.toWebAuthnCredential({
    transport: lib.sdk.toPasskeyTransport(CLIENT_URL, key),
    mode: mode === 'Register' ? lib.sdk.WebAuthnMode.Register : lib.sdk.WebAuthnMode.Login,
    ...opts,
  })
  return { lib, credential, key }
}

function setLive(next: Live) {
  live = next
  liveSession = { address: next.account.address, credentialId: next.credentialId }
}

function start(next: Live) {
  setLive(next)
  savePasskeySession({ address: next.account.address, credentialId: next.credentialId })
}

// The username given to the passkey at sign-up or recovery, kept per account in this browser so My page can show
// it. A login does not return it, so on another browser it is unknown (null).
const USERNAME_KEY = storageKey('passkey.username.')

export function readPasskeyUsername(address: Address): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY + address.toLowerCase())
  } catch {
    return null
  }
}

function rememberPasskeyUsername(address: Address, username: string) {
  try {
    localStorage.setItem(USERNAME_KEY + address.toLowerCase(), username)
  } catch {
    // Storage is unavailable. My page shows the address only.
  }
}

// Creates a new passkey on this device and the smart account it owns on Arc. If this fails after the browser
// saved the passkey, loginPasskey with that passkey opens the same account.
export async function registerPasskey(username: string): Promise<PasskeySession> {
  const { lib, credential, key } = await credentialFor('Register', { username })
  const next = await connectOwn(lib, credential, key)
  // Saved before the session, so the account pill shows the name from its first render.
  rememberPasskeyUsername(next.account.address, username)
  start(next)
  newAccount = live!.account.address.toLowerCase()
  notify()
  return { address: live!.account.address, username }
}

// recoveredElsewhere: the passkey opened its own account, but Circle maps it to another one too. The sign-in shows a
// hint to use the recovery key on this device.
export type LoginResult = PasskeySession & { recoveredElsewhere?: true }

// Logs in with a passkey already on this device. The browser lists the passkeys saved for this site.
export async function loginPasskey(): Promise<LoginResult> {
  const { lib, credential, key } = await credentialFor('Login', {})
  const own = await connectOwn(lib, credential, key)
  const recovered = await recoveredAccount(credential.id, credential.publicKey, own.account.address)
  if (recovered) {
    start(await connect(lib, credential, key, recovered))
    return { address: recovered }
  }
  const elsewhere = await mappedElsewhere(lib, credential.publicKey, own.account.address)
  start(own)
  return { address: own.account.address, ...(elsewhere && { recoveredElsewhere: true as const }) }
}

export function logoutPasskey() {
  clearPasskeySession()
}

// The signing account for the stored session. After a reload this asks for the same passkey once. The session's
// account is the passkey's own, or one recovered with it on this device (see recoveredAccount).
async function ensureLive(stored: StoredPasskey): Promise<Live> {
  // Another tab can move the session to another account of the same passkey, so the cached signer must match both.
  if (live && live.credentialId === stored.credentialId && same(live.account.address, stored.address)) return live
  const { lib, credential, key } = await credentialFor('Login', { credentialId: stored.credentialId })
  let next = await connectOwn(lib, credential, key)
  if (!same(next.account.address, stored.address)) {
    const hadRecord = readRecovered(credential.id) !== null
    const recovered = await recoveredAccount(credential.id, credential.publicKey, next.account.address)
    // Never sign for a wallet other than the one the page shows. A session with no record is most likely a recovery
    // made before records existed: the words, entered once more here, write one.
    if (!recovered && !hadRecord) {
      throw new PlainError('This device needs your recovery key once more to open this account. Sign out, then choose Recover it now.')
    }
    if (!recovered || !same(recovered, stored.address)) {
      throw new PlainError('That passkey opens a different wallet. Sign out and sign in again.')
    }
    next = await connect(lib, credential, key, recovered)
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
      // The signer first, so the check below always runs on a fresh estimate, even right after a reload.
      const { account, bundler } = await ensureLive(stored)
      return passkeySender(account, bundler, liveFunds(stored.address)).send(calls, opts)
    },
    // Reading a receipt needs no signature, so this never asks for the passkey.
    recheck: async (hash) => userOperationResult(await readBundler(), hash),
  }
}

// Account safety. Losing every passkey loses the account, so a new account is asked to add a recovery key
// (Circle's recovery support: the key's address becomes an extra owner of the account). syncBackupFromChain
// reads the owners on Arc, and "saved" is cached per account in this browser.
const BACKUP_KEY = storageKey('backup.')
// A backup user operation that was sent but not confirmed yet. Only the account and the hash, never the words.
const PENDING_KEY = storageKey('backup.pending.')
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

// ownershipInfoOf on Circle's weighted multisig plugin (BaseWeightedMultisigPlugin in circlefin/buidl-wallet-contracts).
// The OwnerData layout was checked against live accounts on Arc mainnet.
const ownershipAbi = parseAbi([
  'struct OwnerData { uint256 weight; uint8 credType; address addr; uint256 publicKeyX; uint256 publicKeyY; }',
  'function ownershipInfoOf(address account) view returns (bytes30[] ownerIds, OwnerData[] ownersData, uint256 thresholdWeight)',
])

// The owner read gives up after this, so a hanging RPC cannot hold back the backup prompt or a recovery.
export const OWNER_READ_TIMEOUT_MS = 8_000

// The account's owners on Arc, or null when the account is not deployed yet (its only owner is then the passkey).
// Rejects on a failed read and after OWNER_READ_TIMEOUT_MS.
async function readOwners(address: Address) {
  const res = await withTimeout(readOwnersNow(address), OWNER_READ_TIMEOUT_MS)
  if (res === 'timeout') throw new Error('Reading the account owners timed out.')
  return res
}

async function readOwnersNow(address: Address) {
  const code = await arcClient.getCode({ address })
  if (!code || code === '0x') return null
  const [ownerIds, ownersData] = await arcClient.readContract({
    address: CIRCLE_MULTISIG_PLUGIN,
    abi: ownershipAbi,
    functionName: 'ownershipInfoOf',
    args: [address],
  })
  return { ownerIds, ownersData }
}

// Decides from the chain whether the account has a backup: a second owner next to the passkey is the recovery
// key. A yes is cached in this browser. A failed read rejects, and the caller keeps the browser's own flag.
export async function syncBackupFromChain(address: Address): Promise<boolean> {
  const owners = await readOwners(address)
  if (!owners || owners.ownerIds.length <= 1) return false
  markBackupSaved(address)
  return true
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

// The USDC a Fundit account must keep back to send one user operation. Before the calls run, the EntryPoint
// takes the prefund: every gas limit times the max fee, less what the account already has deposited there. A
// send that leaves less than that reverts in its own calls ("transfer amount exceeds balance") and still pays
// the fee. The total gas is what passkeySender sends (call gas with withGasMargin). For a form, withGasMargin
// on top covers the fee moving before the send. passkeySender checks with feeMargin false, since it sends the
// very fee it checked. Rounded up to the cent, never below PASSKEY_GAS_BUFFER.
const WEI_PER_UNIT = 10n ** 12n
const CENT = 10_000n
export function reserveFor(gas: UserOperationGas, maxFeePerGas: bigint, depositWei: bigint, feeMargin = true): bigint {
  const total = withGasMargin(gas.callGasLimit) + gas.verificationGasLimit + gas.preVerificationGas
  const prefundWei = feeMargin ? withGasMargin(total * maxFeePerGas) : total * maxFeePerGas
  return roundReserve(prefundWei > depositWei ? prefundWei - depositWei : 0n)
}

function roundReserve(wei: bigint): bigint {
  const units = (wei + WEI_PER_UNIT - 1n) / WEI_PER_UNIT
  const cents = ((units + CENT - 1n) / CENT) * CENT
  return cents > PASSKEY_GAS_BUFFER ? cents : PASSKEY_GAS_BUFFER
}

const depositAbi = parseAbi(['function balanceOf(address account) view returns (uint256)'])

// The account's EntryPoint deposit in native wei (18 decimals). 0 when it cannot be read.
async function readDeposit(address: Address): Promise<bigint> {
  try {
    return await arcClient.readContract({ address: ENTRY_POINT, abi: depositAbi, functionName: 'balanceOf', args: [address] })
  } catch {
    return 0n
  }
}

// When the operation cannot be estimated: measured gas units (FALLBACK_GAS_*) times Circle's low fee now, with
// the fee margin. A new account pays for its own deployment in its first operation. If Circle's fee cannot be
// read either, the highest fee seen stands in.
async function fallbackReserve(address: Address, depositWei: bigint): Promise<bigint> {
  let deployed = false
  try {
    deployed = ((await arcClient.getCode({ address })) ?? '0x') !== '0x'
  } catch {
    // Unknown: keep the larger amount.
  }
  let fee = WORST_SEEN_FEE
  try {
    fee = (await circleFees()).maxFeePerGas
  } catch {
    // Keep the highest fee seen.
  }
  const prefundWei = withGasMargin((deployed ? FALLBACK_GAS_DEPLOYED : FALLBACK_GAS_NEW_ACCOUNT) * fee)
  return roundReserve(prefundWei > depositWei ? prefundWei - depositWei : 0n)
}

// Circle's fee with no signer: the gas price RPC needs only the client key.
async function circleFees(): Promise<UserOperationFees> {
  const lib = await loadSdk()
  return userOperationFees(lib.sdk, clients(lib, clientKey()).client)
}

function liveFunds(address: Address): PasskeyFunds {
  return {
    fees: circleFees,
    usdc: () => usdcOf(address),
    depositWei: () => readDeposit(address),
    fallback: async () => fallbackReserve(address, await readDeposit(address)),
  }
}

// The stand-in operation when the caller has none: a real USDC transfer, 1 unit to another address. A zero
// transfer to the account itself estimated far lower on Arc testnet (0.13 USDC kept against 0.19 needed by
// the real send), and a Max worked out from it was refused.
const STAND_IN_RECIPIENT: Address = '0x000000000000000000000000000000000000dEaD'
export function standInCalls(): Call[] {
  return [{ to: TOKENS.USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [STAND_IN_RECIPIENT, 1n] }) }]
}

// The reserve for these calls (or a stand-in) from this account, for forms: Max and the overdraw checks. It
// estimates with the signer of this page load and Circle's fee, so it never asks for the passkey. With no signer
// yet (after a reload), or when the estimate fails, it uses fallbackReserve. passkeySender checks again with a
// fresh estimate before it sends.
export async function passkeyReserve(address: Address, calls?: readonly Call[]): Promise<bigint> {
  const depositWei = await readDeposit(address)
  const signer = live
  if (signer && signer.account.address.toLowerCase() === address.toLowerCase()) {
    try {
      const lib = await loadSdk()
      const { client } = clients(lib, clientKey())
      const ops = (calls && calls.length > 0 ? calls : standInCalls()).map((c) => ({ to: c.to, data: c.data }))
      const [gas, fees] = await Promise.all([
        signer.bundler.estimateUserOperationGas({ account: signer.account, calls: ops }),
        userOperationFees(lib.sdk, client),
      ])
      return reserveFor(gas, fees.maxFeePerGas, depositWei)
    } catch {
      // Fall back below.
    }
  }
  return fallbackReserve(address, depositWei)
}

export function addAtLeast(reserve: bigint, what = 'It pays the network fee.'): string {
  return `Add at least ${formatAmount(reserve, 'USDC')} to your Fundit account first. ${what}`
}

// True when the account holds enough USDC to pay the backup's network fee.
export async function canPayBackupGas(address: Address): Promise<boolean> {
  const [usdc, reserve] = await Promise.all([usdcOf(address), passkeyReserve(address)])
  return usdc >= reserve
}

function usdcOf(address: Address): Promise<bigint> {
  return arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
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
  const { account, bundler } = await ensureLive(stored)
  const funds = liveFunds(stored.address)
  const kit = await import('./passkeyKit')
  const recoveryAddress = kit.mnemonicToAccount(recoveryPhrase).address
  type Client = Parameters<typeof kit.sdk.recoveryActions>[0]
  type Params = Parameters<ReturnType<typeof kit.sdk.recoveryActions>['registerRecoveryAddress']>[0]
  const actions = kit.sdk.recoveryActions(bundler as unknown as Client)
  const owner = account as unknown as Params['account']
  let hash: Hex
  try {
    // Same margin on the call gas as every other send (see withGasMargin).
    let gas: UserOperationGas
    try {
      gas = await actions.estimateRegisterRecoveryAddressGas({ account: owner, recoveryAddress } as Params)
    } catch (err) {
      // An account that cannot pay the prefund fails the estimate with a code nobody can read.
      if (isPrefundError(err) || isMissingParams(err)) await refuseShortOfReserve(stored.address, await funds.fallback())
      throw err
    }
    // The same check as passkeySender: the prefund at the fee that goes into the operation.
    const [fees, depositWei] = await Promise.all([funds.fees(), funds.depositWei()])
    await refuseShortOfReserve(stored.address, reserveFor(gas, fees.maxFeePerGas, depositWei, false))
    hash = await actions.registerRecoveryAddress({
      account: owner,
      recoveryAddress,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    } as Params)
  } catch (err) {
    if (isAlreadyOwner(err, recoveryAddress)) {
      markBackupSaved(stored.address)
      return 'added'
    }
    if (isUserRejection(err)) throw new PlainError("You cancelled the request. No backup was added. Try again when you're ready.")
    throw err
  }
  savePendingBackup({ account: stored.address, hash, hashKind: 'userop', createdAt: Date.now() })
  return settleBackup(stored.address, await userOperationResult(bundler, hash))
}

// Throws NeedsNetworkFee, with the real number, when the account holds less USDC than the reserve.
async function refuseShortOfReserve(address: Address, reserve: bigint) {
  if ((await usdcOf(address)) < reserve) throw new NeedsNetworkFee(reserve)
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
const RECOVERY_PENDING_KEY = storageKey('recovery.pending.')
// The passkey of a recovery the person started over from. Never the words. recoverWithPhrase looks for it on chain.
const RECOVERY_TRIED_KEY = storageKey('recovery.tried.')
const INVALID_PHRASE = "Those words don't form a valid recovery key. Check the order and spelling."

// publicKey is the new passkey's (x and y, as Circle serializes it), to find it among the owners after Start over.
// username is the new passkey's name, shown on My page once the recovery confirms.
export type PendingRecovery = {
  account: Address
  hash: Hex
  hashKind: 'userop'
  createdAt: number
  credentialId: string
  publicKey?: Hex
  username?: string
}
export type RecoveryResult = { status: 'recovered'; session: StoredPasskey } | { status: 'pending'; account: Address }

// The account cannot pay the recovery's network fee yet. The page shows its address so it can be funded.
export class RecoveryNeedsFunds extends PlainError {
  constructor(
    readonly account: Address,
    readonly reserve: bigint,
  ) {
    super(`Recovery needs a small network fee. Send at least ${formatAmount(reserve, 'USDC')} on Arc to your account address first.`)
  }
}

// The recovery has to make a new passkey and no name was given for it. Recover then asks for one.
export class RecoveryNeedsName extends PlainError {
  constructor() {
    super('Enter a name for your new passkey.')
  }
}

// True when a passkey signed in on this page could finish a recovery without a new passkey (see signedInOwner).
// Recover then asks for a passkey name only if the recovery needs one.
export function canReuseSignedInPasskey(): boolean {
  return live !== null
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
    const publicKey = typeof x.publicKey === 'string' && isHex(x.publicKey) ? x.publicKey : undefined
    const username = typeof x.username === 'string' && x.username.length <= 50 ? x.username : undefined
    return {
      account: x.account,
      hash: x.hash,
      hashKind: 'userop',
      createdAt: x.createdAt,
      credentialId: x.credentialId,
      ...(publicKey && { publicKey }),
      ...(username && { username }),
    }
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

type TriedRecovery = { credentialId: string; publicKey: Hex; createdAt: number }
// The last few attempts are kept, so a late landing is found even after more than one Start over.
const MAX_TRIED = 3

function readTried(account: Address): TriedRecovery[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECOVERY_TRIED_KEY + account.toLowerCase()) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const oldest = Date.now() - BACKUP_MAX_AGE_MS
    return parsed.filter(
      (x: Partial<TriedRecovery> | null): x is TriedRecovery =>
        !!x &&
        typeof x.credentialId === 'string' &&
        x.credentialId !== '' &&
        typeof x.publicKey === 'string' &&
        isHex(x.publicKey) &&
        typeof x.createdAt === 'number' &&
        x.createdAt > oldest,
    )
  } catch {
    return []
  }
}

// Start over: forget a recovery that never confirmed, so a new one can begin. Only the pending record goes. Its
// passkey is kept aside, so the next recovery can find it if this one went through after all.
export function discardPendingRecovery(account: Address) {
  const pending = readPendingRecovery(account)
  try {
    if (pending?.publicKey) {
      const tried = [...readTried(account), { credentialId: pending.credentialId, publicKey: pending.publicKey, createdAt: pending.createdAt }]
      localStorage.setItem(RECOVERY_TRIED_KEY + account.toLowerCase(), JSON.stringify(tried.slice(-MAX_TRIED)))
    }
  } catch {
    // Without storage the next recovery simply makes a new passkey.
  }
  clearPendingRecovery(account)
}

// A 64-byte public key, or 65 bytes with the 0x04 prefix, as x and y (same rule as webauthn-p256 parsePublicKey).
function publicKeyXY(publicKey: Hex): { x: bigint; y: bigint } | null {
  const hex = publicKey.slice(2)
  const body = hex.length === 130 ? hex.slice(2) : hex
  if (body.length !== 128) return null
  return { x: BigInt(`0x${body.slice(0, 64)}`), y: BigInt(`0x${body.slice(64)}`) }
}

// The credential id of a recovery the person started over from, when its passkey is an owner on chain now: that
// recovery went through. null when there is none, none landed, or the chain cannot be read (a new recovery is
// safe then, it only adds another passkey).
async function earlierRecovery(account: Address): Promise<string | null> {
  const tried = readTried(account)
  if (tried.length === 0) return null
  try {
    const owners = await readOwners(account)
    if (!owners) return null
    const found = tried.find((t) => {
      const key = publicKeyXY(t.publicKey)
      return key !== null && owners.ownersData.some((o) => o.publicKeyX === key.x && o.publicKeyY === key.y)
    })
    return found?.credentialId ?? null
  } catch {
    return null
  }
}

// The new passkey owns the account now. The backup flag is cleared, so My page reads the owners on Arc again; the
// recovery key that was just used is still one of them, so it counts as the backup. The signing account loads on
// the next send, with the new passkey.
function finishRecovery(account: Address, credentialId: string): RecoveryResult {
  clearPendingRecovery(account)
  savedThisLoad.delete(account.toLowerCase())
  try {
    localStorage.removeItem(RECOVERY_TRIED_KEY + account.toLowerCase())
    localStorage.removeItem(BACKUP_KEY + account.toLowerCase())
  } catch {
    // Nothing stored to clear.
  }
  // The proof that this device recovered the account with this passkey (see recoveredAccount).
  rememberRecovered(credentialId, account)
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
  if (pending.username) rememberPasskeyUsername(pending.account, pending.username)
  return finishRecovery(pending.account, pending.credentialId)
}

// The credential id of the passkey signed in on this page when both it and the recovery key own the account on Arc.
// null otherwise, or when the owners cannot be read: the recovery then adds a new passkey, which is always safe.
async function signedInOwner(account: Address, recoveryAddress: Address): Promise<string | null> {
  const current = live
  if (!current) return null
  try {
    const owners = await readOwners(account)
    const key = publicKeyXY(current.publicKey)
    if (!owners || !key) return null
    const keyOwns = owners.ownersData.some((o) => o.addr.toLowerCase() === recoveryAddress.toLowerCase())
    const passkeyOwns = owners.ownersData.some((o) => o.publicKeyX === key.x && o.publicKeyY === key.y)
    return keyOwns && passkeyOwns ? current.credentialId : null
  } catch {
    return null
  }
}

// Recovers a passkey account with its recovery key, as in Circle's passkey-recovery example:
// 1. the words become a local account (viem mnemonicToAccount), checked first so a typo sends nothing;
// 2. Circle's address mapping (made by registerRecoveryAddress) gives the account that key belongs to;
// 3. the account must hold its reserve (passkeyReserve), since it pays the fee in USDC (no paymaster);
// 4. a new passkey is registered with the given name;
// 5. executeRecovery, signed by the local account, adds the new passkey as an owner.
// 'pending' means the operation went out but did not confirm in time. It is saved (never the words) and
// checkPendingRecovery finishes it. While it is pending, no second recovery is sent for that account.
export async function recoverWithPhrase(p: { phrase: string; username?: string }): Promise<RecoveryResult> {
  const phrase = normalizePhrase(p.phrase)
  if (!(await isValidRecoveryPhrase(phrase))) throw new PlainError(INVALID_PHRASE)
  const username = (p.username ?? '').trim()
  const key = clientKey()
  const lib = await loadSdk()
  const { sdk } = lib
  const recovery = lib.viem.mnemonicToAccount(phrase)
  const { transport, client } = clients(lib, key)

  let wallets = await mappedWallets(sdk, client, { type: sdk.OwnerIdentifierType.EOA, identifier: { address: recovery.address } })
  if (wallets.length === 0) throw new PlainError("We couldn't find a Fundit account for this recovery key. Check the words and try again.")
  if (wallets.length > 1) {
    // Circle can also hold a wallet made for the key itself. The account that added the key is deployed on Arc.
    const deployed = await Promise.all(wallets.map(async (w) => ((await arcClient.getCode({ address: w })) ?? '0x') !== '0x'))
    wallets = wallets.filter((_, i) => deployed[i])
    if (wallets.length > 1) {
      // The key's address is public on chain, so anyone can map it to their own account. Only an account that lists
      // the key as an owner on Arc counts.
      const owned = await Promise.all(
        wallets.map(async (w) => !!(await readOwners(w))?.ownersData.some((o) => o.addr.toLowerCase() === recovery.address.toLowerCase())),
      )
      wallets = wallets.filter((_, i) => owned[i])
    }
    if (wallets.length !== 1) throw new PlainError('This recovery key belongs to more than one account, so Fundit cannot pick one. Sign in with a passkey for the account instead.')
  }
  const account = wallets[0]!

  const pending = readPendingRecovery(account)
  if (pending) return { status: 'pending', account }
  // After Start over: the earlier recovery may have gone through. Then its passkey opens the account.
  const earlier = await earlierRecovery(account)
  if (earlier) return finishRecovery(account, earlier)
  // The passkey signed in on this page may already own the account: a synced passkey whose account was recovered on
  // another device. Then the words, whose key is an owner too, are the proof, and nothing is sent.
  const already = await signedInOwner(account, recovery.address)
  if (already) return finishRecovery(account, already)
  // From here a new passkey is made, and it needs a name.
  if (username === '') throw new RecoveryNeedsName()
  const [held, reserve] = await Promise.all([usdcOf(account), passkeyReserve(account)])
  if (held < reserve) throw new RecoveryNeedsFunds(account, reserve)

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
  const record: PendingRecovery = { account, hash, hashKind: 'userop', createdAt: Date.now(), credentialId: credential.id, publicKey: credential.publicKey, username }
  savePendingRecovery(record)
  return settleRecovery(record, await userOperationResult(bundler as unknown as ReceiptBundler, hash))
}

// Checks a pending recovery with a receipt read. It never sends anything again and needs no passkey. 'stuck' is
// a pending recovery still without a receipt after BACKUP_STUCK_MS: the person may start over.
export async function checkPendingRecovery(account: Address): Promise<RecoveryResult | { status: 'stuck'; account: Address } | { status: 'none' }> {
  const pending = readPendingRecovery(account)
  if (!pending) return { status: 'none' }
  const res = settleRecovery(pending, await userOperationResult(await readBundler(), pending.hash))
  return res.status === 'pending' && Date.now() - pending.createdAt > BACKUP_STUCK_MS ? { status: 'stuck', account } : res
}

// True when Circle's Arc endpoint for this network answers with that network's chain id. Run by hand once a client key exists.
export async function probeModularArc(): Promise<boolean> {
  const { sdk } = await loadSdk()
  const transport = sdk.toModularTransport(ARC_URL, clientKey())({ chain: undefined })
  const id = await transport.request({ method: 'eth_chainId' })
  return id === ARC_CHAIN_HEX
}
