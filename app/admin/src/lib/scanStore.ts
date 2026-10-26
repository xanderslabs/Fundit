import type { Address } from 'viem'
import type { ScanState } from './historyScan'
import type { AdminNetwork } from './networks'

// The history scan's saved state, in this browser's localStorage only. One entry per network and factory, so a
// scan of one never feeds another. bigints are saved as decimal strings.

export function storageKey(network: AdminNetwork, factory: Address): string {
  return `fundit-admin:scan:v1:${network}:${factory.toLowerCase()}`
}

const BIGINT_FIELDS = new Set(['scannedTo', 'blockNumber', 'readTo'])

export function load(network: AdminNetwork, factory: Address): ScanState | null {
  try {
    const text = localStorage.getItem(storageKey(network, factory))
    if (!text) return null
    const state = JSON.parse(text, (k, v) => (BIGINT_FIELDS.has(k) && typeof v === 'string' ? BigInt(v) : v)) as ScanState
    if (state.v !== 1 || state.network !== network || state.factory.toLowerCase() !== factory.toLowerCase()) return null
    return state
  } catch {
    // Blocked storage or broken text: start again.
    return null
  }
}

// false when the browser refuses (storage blocked, or full).
export function save(state: ScanState): boolean {
  try {
    const text = JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    localStorage.setItem(storageKey(state.network, state.factory), text)
    return true
  } catch {
    return false
  }
}

export function clear(network: AdminNetwork, factory: Address): void {
  try {
    localStorage.removeItem(storageKey(network, factory))
  } catch {
    // Nothing was saved there.
  }
}
