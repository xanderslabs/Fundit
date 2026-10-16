import { useSyncExternalStore } from 'react'
import { type Address, type Hex, isAddress, type TransactionReceipt, type Transport } from 'viem'
import { arc } from 'viem/chains'
import { CIRCLE_CLIENT_KEY, MODULAR_WALLETS_URL, PASSKEYS_ENABLED, TX_TIMEOUT_MS } from '../config'
import { isUserRejection } from './errors'
import { type Call, REVERTED, type Sender, type TxResult, withGasMargin, withTimeout } from './sender'

// Circle Modular Wallets. The SDK is large and only passkey users need it, so it loads with import() on
// first use. The WebAuthn rpId comes from Circle and is bound to the client key's domain (fundit.xyz, or
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
    async send(calls) {
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

// Creates a new passkey on this device and the smart account it owns on Arc.
export async function registerPasskey(username: string): Promise<PasskeySession> {
  start(await credentialFor('Register', { username }))
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
    throw new Error('That passkey opens a different wallet. Log out and log in again.')
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

// True when Circle's Arc mainnet endpoint answers with Arc's chain id. Run by hand once a client key exists.
export async function probeModularArc(): Promise<boolean> {
  const { sdk } = await loadSdk()
  const transport = sdk.toModularTransport(ARC_URL, clientKey())({ chain: undefined })
  const id = await transport.request({ method: 'eth_chainId' })
  return id === ARC_CHAIN_HEX
}
