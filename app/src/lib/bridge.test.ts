import { type Address, getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPayout,
  clearPendingArc,
  markPayoutMinted,
  pendingArc,
  pendingPayoutFrom,
  pendingPayouts,
  savePendingArc,
  savePendingPayout,
} from './bridge'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const OTHER = getAddress('0x00000000000000000000000000000000000000b2')
const BURN = `0x${'cd'.repeat(32)}` as Hex
const KEY = 'fundit.pendingBridges'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('pending store', () => {
  // Private windows and blocked storage throw on access. The page must still load and donate.
  it('the store survives a localStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(pendingPayouts()).toEqual([])
    expect(() => clearPayout(BURN)).not.toThrow()
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  // Testnet entries on domains 0 and 6 look valid on mainnet, which would then poll mainnet Iris for them.
  it('keeps testnet entries under their own key, apart from mainnet ones', async () => {
    const entry = { kind: 'arc', campaign: CAMPAIGN, hash: BURN, createdAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify([entry]))
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    try {
      const fresh = await import('./bridge')
      expect(fresh.pendingArc(CAMPAIGN)).toBeNull()
      localStorage.setItem('fundit.testnet.pendingBridges', JSON.stringify([entry]))
      expect(fresh.pendingArc(CAMPAIGN)).toMatchObject({ hash: BURN })
      fresh.clearPendingArc(CAMPAIGN)
      expect(localStorage.getItem('fundit.testnet.pendingBridges')).toBeNull()
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([entry])
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('ignores corrupt or foreign data under the key', () => {
    localStorage.setItem(KEY, '{not json')
    expect(pendingPayouts()).toEqual([])
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'payout', campaign: 'javascript:alert(1)', burnTx: 'x' }, 42, null]))
    expect(pendingPayouts()).toEqual([])
  })

  // Old reminders must not pile up forever.
  it('prunes entries older than 7 days on read', () => {
    const old = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '1', createdAt: old },
        { kind: 'arc', campaign: CAMPAIGN, hash: BURN, createdAt: old },
        { kind: 'payout', campaign: OTHER, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '1', createdAt: Date.now() },
      ]),
    )
    expect(pendingArc(CAMPAIGN)).toBeNull()
    expect(pendingPayouts().map((b) => b.campaign)).toEqual([OTHER])
  })

  it('keeps the first createdAt when the same Arc transaction is saved again', () => {
    // The age decides the "more than a day ago" warning, so a re-save on mount must not reset it.
    const t = Date.now() - 5000
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: BURN, createdAt: t }]))
    savePendingArc({ campaign: CAMPAIGN, hash: BURN })
    expect(pendingArc(CAMPAIGN)!.createdAt).toBe(t)
  })

  // Older builds saved a passkey user operation hash with hashKind 'userop'. Nothing can check that hash any
  // more, so the record is dropped on read: it must not throw, and it must not block a new gift forever.
  it('a saved userop pending record is ignored without throwing', () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: false, hashKind: 'userop', createdAt: Date.now() }]))
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  // An approval hash moves nothing to the campaign. Reading it as a donation would show "Your donation went through".
  it('a saved approve: true record is ignored', () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: true, createdAt: Date.now() }]))
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  it('keeps one unconfirmed Arc donation per campaign, apart from payouts', () => {
    savePendingArc({ campaign: CAMPAIGN, hash: BURN })
    expect(pendingArc(CAMPAIGN)).toMatchObject({ kind: 'arc', campaign: CAMPAIGN, hash: BURN })
    expect(pendingArc(OTHER)).toBeNull()
    expect(pendingPayouts()).toEqual([])
    clearPendingArc(CAMPAIGN)
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })
})

// A payout burns on Arc and mints to the organiser's address on another chain. It is money leaving the campaign,
// so it must never be read as an unconfirmed donation.
describe('pending payouts', () => {
  afterEach(() => localStorage.clear())

  it('saves a payout from Arc (domain 26) and lists it apart from Arc donations', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    expect(pendingPayouts()).toMatchObject([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '9.9' }])
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  // Add money from another chain is gone. Its records left in a browser are dropped on read.
  it('drops bridge and submitted records from the removed Add money flow', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '1', createdAt: Date.now() },
        { kind: 'submitted', id: 's-1', campaign: CAMPAIGN, srcDomain: 6, amount: '1', createdAt: Date.now() },
      ]),
    )
    expect(pendingPayouts()).toEqual([])
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  it('is marked minted and cleared by its burn hash', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    markPayoutMinted(BURN)
    expect(pendingPayouts()[0]!.minted).toBe(true)
    clearPayout(BURN)
    expect(pendingPayouts()).toEqual([])
  })

  // A Fundit account's own send to another chain is saved the same way, keyed by the account. While it has not
  // arrived, a second one waits, so the person does not send twice by mistake.
  it('finds the unarrived payout from an address, and lets go once it arrived', () => {
    expect(pendingPayoutFrom(CAMPAIGN)).toBeNull()
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    expect(pendingPayoutFrom(CAMPAIGN.toLowerCase() as Address)).toMatchObject({ burnTx: BURN })
    expect(pendingPayoutFrom(OTHER)).toBeNull()
    markPayoutMinted(BURN)
    expect(pendingPayoutFrom(CAMPAIGN)).toBeNull()
  })

  it('clearPayout removes only that payout', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '1' })
    savePendingPayout({ campaign: OTHER, burnTx: `0x${'ee'.repeat(32)}`, destDomain: 0, amount: '2' })
    clearPayout(BURN)
    expect(pendingPayouts().map((b) => b.campaign as Address)).toEqual([OTHER])
  })

  it('ignores a payout entry with an unknown destination', () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 99, amount: '1', createdAt: Date.now() }]))
    expect(pendingPayouts()).toEqual([])
  })
})
