import { type Address, type Chain, createPublicClient, type EIP1193Provider, getAddress, type Hex, http, isAddress, isHex, parseUnits, UserRejectedRequestError } from 'viem'
import { ARC_CHAIN_ID, ARC_DOMAIN, ARC_RPC_URL, NETWORK, CCTP_CHAINS, CHAIN_LABELS, type CctpChain, type CctpChainKey } from '../config'
import { isUserRejection } from './errors'

// One localStorage key holds everything that must survive a reload: cross-chain transfers on their way
// to Arc (with a burn hash, or only 'submitted' when the wallet has sent but no burn hash is known yet),
// at most one unconfirmed Arc donation per campaign, and payouts from Arc to another chain. Storage can throw (private windows,
// blocked site data), so every access is wrapped and a failure only loses the reminder, never money.
const KEY = 'fundit.pendingBridges'
// Fired on window after every change, so open trackers re-read the store.
export const PENDING_EVENT = 'fundit:pending'
// Entries older than this are dropped on read, so stale reminders do not pile up.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// minted is set once Iris reports the mint on Arc. The entry stays for its thank-you row but no longer blocks.
export type PendingBridge = { kind: 'bridge'; campaign: Address; burnTx: Hex; srcDomain: number; amount: string; minted?: true; createdAt: number }
export type PendingSubmitted = { kind: 'submitted'; id: string; campaign: Address; srcDomain: number; amount: string; createdAt: number }
// hashKind 'userop' marks a passkey user operation hash, which only the passkey bundler can check.
export type PendingArc = { kind: 'arc'; campaign: Address; hash: Hex; approve: boolean; hashKind?: 'userop'; createdAt: number }
// An organiser's withdrawal burned on Arc (domain 26) and minted on destDomain. Money leaving the campaign, so
// it never blocks a donation. minted works as for PendingBridge.
export type PendingPayout = {
  kind: 'payout'
  campaign: Address
  burnTx: Hex
  srcDomain: typeof ARC_DOMAIN
  destDomain: number
  amount: string
  minted?: true
  createdAt: number
}
export type PendingCrossChain = PendingBridge | PendingSubmitted
type Entry = PendingBridge | PendingSubmitted | PendingArc | PendingPayout

const isTxHash = (v: unknown): v is Hex => typeof v === 'string' && isHex(v) && v.length === 66

function isEntry(e: unknown): e is Entry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  if (typeof x.campaign !== 'string' || !isAddress(x.campaign) || typeof x.createdAt !== 'number') return false
  const knownDomain = CCTP_CHAINS.some((c) => c.domain === x.srcDomain)
  if (x.kind === 'bridge') return isTxHash(x.burnTx) && knownDomain && typeof x.amount === 'string' && (x.minted === undefined || x.minted === true)
  if (x.kind === 'submitted') return typeof x.id === 'string' && knownDomain && typeof x.amount === 'string'
  if (x.kind === 'payout') {
    return (
      isTxHash(x.burnTx) &&
      x.srcDomain === ARC_DOMAIN &&
      CCTP_CHAINS.some((c) => c.domain === x.destDomain) &&
      typeof x.amount === 'string' &&
      (x.minted === undefined || x.minted === true)
    )
  }
  if (x.kind === 'arc') return isTxHash(x.hash) && typeof x.approve === 'boolean' && (x.hashKind === undefined || x.hashKind === 'userop')
  return false
}

function readAll(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    const oldest = Date.now() - MAX_AGE_MS
    return Array.isArray(parsed) ? parsed.filter((e): e is Entry => isEntry(e) && e.createdAt > oldest) : []
  } catch {
    return []
  }
}

function writeAll(entries: Entry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Storage is unavailable. The transaction itself is unaffected.
  }
  window.dispatchEvent(new Event(PENDING_EVENT))
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Calls back on every change to the store: from this tab (PENDING_EVENT) and from other tabs (the browser's
// storage event, which never fires in the tab that wrote). Returns the unsubscribe function.
export function subscribePending(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) callback()
  }
  window.addEventListener(PENDING_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PENDING_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

// Tells every listener in this tab to read the store again, for example after a submit found a donation
// that another tab saved without this tab hearing of it.
export function notifyPending() {
  window.dispatchEvent(new Event(PENDING_EVENT))
}

export function pendingBridges(): PendingBridge[] {
  return readAll().filter((e): e is PendingBridge => e.kind === 'bridge')
}

const isBurn = (e: Entry, burnTx: Hex): e is PendingBridge | PendingPayout =>
  (e.kind === 'bridge' || e.kind === 'payout') && same(e.burnTx, burnTx)

// Clears a transfer to a Fundit account or a payout by its burn hash.
export function clearBridge(burnTx: Hex) {
  writeAll(readAll().filter((e) => !isBurn(e, burnTx)))
}

export function markBridgeMinted(burnTx: Hex) {
  const all = readAll()
  if (!all.some((e) => isBurn(e, burnTx) && !e.minted)) return
  writeAll(all.map((e) => (isBurn(e, burnTx) ? { ...e, minted: true as const } : e)))
}

export function pendingPayouts(): PendingPayout[] {
  return readAll().filter((e): e is PendingPayout => e.kind === 'payout')
}

// A payout from this address that has not arrived yet. A Fundit account's own send to another chain is saved as
// a payout with the account's address in campaign, so this keeps it to one at a time.
export function pendingPayoutFrom(address: Address): PendingPayout | null {
  return pendingPayouts().find((e) => same(e.campaign, address) && !e.minted) ?? null
}

// Saved once the withdrawal's Arc receipt is in. The Arc transaction is the CCTP burn Iris reports on.
export function savePendingPayout(p: { campaign: Address; burnTx: Hex; destDomain: number; amount: string }) {
  const all = readAll().filter((e) => !isBurn(e, p.burnTx))
  writeAll([...all, { kind: 'payout', ...p, srcDomain: ARC_DOMAIN, createdAt: Date.now() }])
}

// An entry whose money may still move to this address: an unconfirmed donation to a campaign, or a transfer on
// its way to a Fundit account. While one exists, no new one may start, or the money could move twice.
export type BlockingEntry = PendingArc | PendingSubmitted | (PendingBridge & { minted?: undefined })

export function blockingEntry(campaign: Address): BlockingEntry | null {
  const mine = readAll().filter((e) => same(e.campaign, campaign))
  return (
    mine.find((e): e is PendingArc => e.kind === 'arc') ??
    mine.find((e): e is BlockingEntry => (e.kind === 'bridge' && !e.minted) || e.kind === 'submitted') ??
    null
  )
}

// Bridges and submitted transfers, for the tracker.
export function pendingCrossChain(): PendingCrossChain[] {
  return readAll().filter((e): e is PendingCrossChain => e.kind === 'bridge' || e.kind === 'submitted')
}

export function clearSubmitted(id: string) {
  writeAll(readAll().filter((e) => !(e.kind === 'submitted' && e.id === id)))
}

// Replaces the submitted record (if any) with the burn, keeping its createdAt: the entry expires 7 days after the
// first send, and the tracker shows it as overdue 2 hours after it.
function saveBridge(entry: Omit<PendingBridge, 'kind' | 'createdAt'>, submittedId: string) {
  const all = readAll()
  const submitted = all.find((e) => e.kind === 'submitted' && e.id === submittedId)
  const rest = all.filter((e) => e !== submitted)
  writeAll([...rest, { kind: 'bridge', ...entry, createdAt: submitted?.createdAt ?? Date.now() }])
}

export function pendingArc(campaign: Address): PendingArc | null {
  return readAll().find((e): e is PendingArc => e.kind === 'arc' && same(e.campaign, campaign)) ?? null
}

// Saving the same transaction again keeps its first createdAt, so its age stays true after a reload.
export function savePendingArc(p: { campaign: Address; hash: Hex; approve: boolean; hashKind?: 'userop' }) {
  const all = readAll()
  const prev = all.find((e): e is PendingArc => e.kind === 'arc' && same(e.campaign, p.campaign))
  const createdAt = prev && same(prev.hash, p.hash) ? prev.createdAt : Date.now()
  writeAll([...all.filter((e) => e !== prev), { kind: 'arc', ...p, createdAt }])
}

export function clearPendingArc(campaign: Address) {
  const all = readAll()
  const rest = all.filter((e) => !(e.kind === 'arc' && same(e.campaign, campaign)))
  if (rest.length !== all.length) writeAll(rest)
}

export function chainByKey(key: CctpChainKey): CctpChain {
  return CCTP_CHAINS.find((c) => c.key === key)!
}

// account is the address the app shows as connected (wagmi). It keys the adapter cache; eth_accounts is the fallback.
export type CrossChainParams = {
  provider: EIP1193Provider
  sourceKey: CctpChainKey
  campaign: Address
  amount: string
  fast: boolean
  account?: Address
}

const SEND_METHODS = new Set(['eth_sendTransaction', 'wallet_sendCalls'])

// Passes every call to the wallet, and reports each successful send to whoever is listening. The adapter
// reads only request() (through viem's custom transport), so a plain object is enough.
function watchSends(provider: EIP1193Provider, watcher: Watcher): EIP1193Provider {
  const request = (async (args: { method: string }) => {
    const result = await provider.request(args as never)
    if (SEND_METHODS.has(args.method)) watcher.onSend?.()
    return result
  }) as EIP1193Provider['request']
  return { request } as EIP1193Provider
}

type Watcher = { onSend: (() => void) | null }
type ViemAdapter = Awaited<ReturnType<typeof import('@circle-fin/adapter-viem-v2')['createViemAdapterFromProvider']>>

// The SDKs are large, so they load only when someone adds money from another chain.
async function createAdapter(provider: EIP1193Provider): Promise<{ adapter: ViemAdapter; watcher: Watcher }> {
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2')
  const watcher: Watcher = { onSend: null }
  const adapter = await createViemAdapterFromProvider({
    provider: watchSends(provider, watcher),
    // Reads go through our own RPCs, which are the hosts the CSP allows, not the SDK's defaults.
    getPublicClient: ({ chain: c }: { chain: Chain }) => createPublicClient({ chain: c, transport: http(rpcFor(c.id)) }),
    capabilities: { addressContext: 'user-controlled' },
  })
  return { adapter, watcher }
}

// One adapter per wallet provider and account. The adapter caches the first account it sees, and a
// wallet keeps the same provider across account switches, so the account is part of the key. The adapter
// picks the chain per call, so one serves every chain.
const adapters = new WeakMap<EIP1193Provider, Map<string, ReturnType<typeof createAdapter>>>()

async function currentAccount(provider: EIP1193Provider, known?: Address): Promise<string> {
  if (known) return known.toLowerCase()
  // eth_accounts never prompts. An empty answer, or a wallet that throws, gets its own entry; the adapter
  // then asks for access.
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as readonly string[] | undefined
    return accounts?.[0]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

async function cachedAdapter(provider: EIP1193Provider, known?: Address) {
  const account = await currentAccount(provider, known)
  let byAccount = adapters.get(provider)
  if (!byAccount) {
    byAccount = new Map()
    adapters.set(provider, byAccount)
  }
  let entry = byAccount.get(account)
  if (!entry) {
    const created = createAdapter(provider)
    byAccount.set(account, created)
    // A failed load must not stick for this wallet.
    created.catch(() => byAccount.delete(account))
    entry = created
  }
  return entry
}

let bridgeKit: Promise<import('@circle-fin/bridge-kit').BridgeKit> | null = null

function loadBridgeKit() {
  if (!bridgeKit) {
    const loading = import('@circle-fin/bridge-kit').then(
      // Error reporting off: the SDK would otherwise POST error details to Circle.
      ({ BridgeKit }) => new BridgeKit({ disableErrorReporting: true }),
    )
    loading.catch(() => {
      bridgeKit = null
    })
    bridgeKit = loading
  }
  return bridgeKit
}

async function setup(p: CrossChainParams) {
  const chain = chainByKey(p.sourceKey)
  if (p.fast && !chain.fast) throw new Error(`Fast transfers are not available from ${CHAIN_LABELS[chain.key]}.`)
  const [kit, { adapter, watcher }] = await Promise.all([loadBridgeKit(), cachedAdapter(p.provider, p.account)])
  const params = {
    from: { adapter, chain: chain.bridgeKitChain },
    // The forwarder mints straight to the campaign contract on Arc. No donate() call follows.
    to: { chain: NETWORK.bridgeKitChain, recipientAddress: getAddress(p.campaign), useForwarder: true as const },
    amount: p.amount,
    config: { transferSpeed: p.fast ? ('FAST' as const) : ('SLOW' as const) },
  }
  return { kit, params, chain, watcher }
}

function rpcFor(chainId: number): string | undefined {
  if (chainId === ARC_CHAIN_ID) return ARC_RPC_URL
  return CCTP_CHAINS.find((c) => c.chainId === chainId)?.rpcUrl
}

// Total USDC the transfer costs out of the amount (CCTP fee plus forwarding fee), in 6-decimal units.
// Source-chain gas is separate and paid in that chain's native token.
export async function estimateCrossChain(p: CrossChainParams): Promise<bigint> {
  const { kit, params } = await setup(p)
  const est = await kit.estimate(params)
  let total = 0n
  for (const fee of est.fees) {
    if (fee.amount === null || fee.token !== 'USDC') throw new Error('Could not estimate the transfer fees.')
    total += parseUnits(fee.amount, 6)
  }
  return total
}

type Step = { name?: string; state?: string; txHash?: string; errorMessage?: string; errorCategory?: string; error?: unknown }

// A burn that may be on chain: mined, or its receipt wait timed out. A reverted burn moved nothing.
function burnMayBeOnChain(step: Step): step is Step & { txHash: string } {
  if (!isTxHash(step.txHash)) return false
  if (step.state === 'success') return true
  return step.state === 'error' && step.errorCategory !== 'reverted_onchain' && step.errorCategory !== 'chain_revert'
}

function stepError(step: Step | undefined): Error {
  // Sequential wallets: the adapter wraps the rejection, so the category is only 'unknown'.
  if (step?.errorCategory === 'user_rejected' || isUserRejection(step?.error)) {
    return new UserRejectedRequestError(new Error(step?.errorMessage ?? 'User rejected'))
  }
  const err = new Error(step?.errorMessage ?? 'The transfer did not start.')
  if (step?.error !== undefined) err.cause = step.error
  return err
}

// Burns USDC on the source chain and returns as soon as the burn has a hash. Circle's forwarder then
// mints it to the campaign on Arc; the tracker follows that through Iris, even after a reload.
export async function donateCrossChain(p: CrossChainParams): Promise<{ burnTx: Hex; srcDomain: number }> {
  const { kit, params, chain, watcher } = await setup(p)
  const campaign = getAddress(p.campaign)
  // Saved on the wallet's first send, before any burn hash, in case the tab closes before the burn event.
  const submittedId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let submitted = false
  watcher.onSend = () => {
    if (submitted) return
    submitted = true
    writeAll([...readAll(), { kind: 'submitted', id: submittedId, campaign, srcDomain: chain.domain, amount: p.amount, createdAt: Date.now() }])
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      settled = true
      watcher.onSend = null
      kit.off('burn', onBurn)
    }
    // After a send with no burn hash (a batched step error, for example) the outcome is unknown, so the
    // submitted record stays until it expires. Only a clear rejection removes it.
    const fail = (err: unknown) => {
      finish()
      if (submitted && isUserRejection(err)) clearSubmitted(submittedId)
      reject(err)
    }
    const onBurn = (payload: { values: Step }) => {
      const step = payload.values
      if (settled || !burnMayBeOnChain(step)) return
      finish()
      const burnTx = step.txHash as Hex
      saveBridge({ campaign, burnTx, srcDomain: chain.domain, amount: p.amount }, submittedId)
      resolve({ burnTx, srcDomain: chain.domain })
    }
    kit.on('burn', onBurn)
    // bridge() keeps running after we resolve, until the mint. Its outcome then only matters if no burn was seen.
    kit.bridge(params).then(
      (result) => {
        if (settled) return
        const steps = (result?.steps ?? []) as Step[]
        // In case the burn event was missed, the result still lists the burn step.
        const burn = steps.find((s) => s.name === 'burn')
        if (burn) onBurn({ values: burn })
        if (settled) return
        fail(stepError(steps.find((s) => s.state === 'error')))
      },
      (err: unknown) => {
        if (!settled) fail(err)
      },
    )
  })
}
