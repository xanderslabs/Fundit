import { type Address, type Hex, isAddress, isHex } from 'viem'
import { ARC_DOMAIN, CCTP_CHAINS, type CctpChain, type CctpChainKey, storageKey } from '../config'

// One localStorage key holds everything that must survive a reload: at most one unconfirmed Arc donation per
// campaign, and payouts from Arc to another chain. Storage can throw (private windows, blocked site data), so every
// access is wrapped and a failure only loses the reminder, never money. The key keeps its old name, so payouts
// saved by earlier builds are still found.
const KEY = storageKey('pendingBridges')
// Fired on window after every change, so open trackers re-read the store.
export const PENDING_EVENT = 'fundit:pending'
// Entries older than this are dropped on read, so stale reminders do not pile up.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type PendingArc = { kind: 'arc'; campaign: Address; hash: Hex; createdAt: number }
// An organiser's withdrawal burned on Arc (domain 26) and minted on destDomain. Money leaving the campaign, so
// it never blocks a donation. minted is set once Iris reports the mint; the entry then stays for its arrived row.
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
type Entry = PendingArc | PendingPayout

const isTxHash = (v: unknown): v is Hex => typeof v === 'string' && isHex(v) && v.length === 66

function isEntry(e: unknown): e is Entry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  if (typeof x.campaign !== 'string' || !isAddress(x.campaign) || typeof x.createdAt !== 'number') return false
  if (x.kind === 'payout') {
    return (
      isTxHash(x.burnTx) &&
      x.srcDomain === ARC_DOMAIN &&
      CCTP_CHAINS.some((c) => c.domain === x.destDomain) &&
      typeof x.amount === 'string' &&
      (x.minted === undefined || x.minted === true)
    )
  }
  // An older build saved a user operation hash (hashKind) or an approval hash (approve: true). Neither is a donation
  // hash and nothing can check them now, so they are dropped.
  if (x.kind === 'arc') return isTxHash(x.hash) && x.approve !== true && x.hashKind === undefined
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

const isBurn = (e: Entry, burnTx: Hex): e is PendingPayout => e.kind === 'payout' && same(e.burnTx, burnTx)

// Clears a payout by its burn hash.
export function clearPayout(burnTx: Hex) {
  writeAll(readAll().filter((e) => !isBurn(e, burnTx)))
}

export function markPayoutMinted(burnTx: Hex) {
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

export function pendingArc(campaign: Address): PendingArc | null {
  return readAll().find((e): e is PendingArc => e.kind === 'arc' && same(e.campaign, campaign)) ?? null
}

// Saving the same transaction again keeps its first createdAt, so its age stays true after a reload.
export function savePendingArc(p: { campaign: Address; hash: Hex }) {
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
