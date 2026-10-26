import type { Address, Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialScanState, type ScanState } from './historyScan'
import { ADMIN_NETWORKS } from './networks'
import { clear, load, save, storageKey } from './scanStore'

const OTHER_FACTORY = `0x${'f'.repeat(40)}` as Address
const A = `0x${'a'.repeat(40)}` as Address

function scanned(network: 'mainnet' | 'testnet'): ScanState {
  const s = initialScanState(network)
  return {
    ...s,
    scannedTo: s.scannedTo + 12_345n,
    covered: [A],
    events: [
      {
        kind: 'Donated',
        address: A,
        blockNumber: 2n ** 63n + 7n,
        logIndex: 4,
        txHash: `0x${'2'.repeat(64)}` as Hex,
        args: { donor: A, amount: '123456789012345678901234567890', fee: '0', tip: '1' },
      },
      { kind: 'CreationPausedSet', address: s.factory, blockNumber: 9n, logIndex: 0, txHash: `0x${'3'.repeat(64)}` as Hex, args: { paused: true } },
    ],
    backfill: { addresses: [A], readTo: 2n ** 70n },
  }
}

// Saved scans are keyed by network and factory, so one never feeds another.
describe('scanStore', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('uses a key per network and lowercased factory', () => {
    expect(storageKey('testnet', A.toUpperCase().replace('0X', '0x') as Address)).toBe(`fundit-admin:scan:v1:testnet:${A}`)
  })

  it('keeps mainnet and testnet scans apart', () => {
    expect(save(scanned('testnet'))).toBe(true)
    expect(load('mainnet', ADMIN_NETWORKS.mainnet.factory)).toBeNull()
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).not.toBeNull()
  })

  it('does not load a scan saved under another factory', () => {
    save({ ...scanned('testnet'), factory: OTHER_FACTORY })
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).toBeNull()
    expect(load('testnet', OTHER_FACTORY)?.factory).toBe(OTHER_FACTORY)
  })

  it('clear removes only the asked network and factory', () => {
    save(scanned('testnet'))
    save(scanned('mainnet'))
    save({ ...scanned('testnet'), factory: OTHER_FACTORY })
    clear('testnet', ADMIN_NETWORKS.testnet.factory)
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).toBeNull()
    expect(load('mainnet', ADMIN_NETWORKS.mainnet.factory)).not.toBeNull()
    expect(load('testnet', OTHER_FACTORY)).not.toBeNull()
  })

  it('save returns false when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    expect(save(scanned('testnet'))).toBe(false)
  })

  it('load returns null when storage is blocked or the saved text is broken', () => {
    localStorage.setItem(storageKey('testnet', ADMIN_NETWORKS.testnet.factory), '{not json')
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).toBeNull()
  })

  it('round-trips bigint fields', () => {
    const s = scanned('testnet')
    save(s)
    expect(load('testnet', ADMIN_NETWORKS.testnet.factory)).toEqual(s)
  })
})
