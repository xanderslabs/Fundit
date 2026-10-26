import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import type { ScanEvent } from './historyScan'
import { settingChanges } from './settingsHistory'

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address
const FACTORY = addr(100)
const tx = (i: number) => `0x${i.toString(16).padStart(64, '0')}` as Hex

function ev(kind: ScanEvent['kind'], blockNumber: number, args: ScanEvent['args'], logIndex = 0): ScanEvent {
  return { kind, address: FACTORY, blockNumber: BigInt(blockNumber), logIndex, txHash: tx(blockNumber), args }
}

describe('settingChanges', () => {
  it('gives the previous value of the same kind as old', () => {
    const out = settingChanges([
      ev('FeesUpdated', 10, { donationFeeBps: '250', withdrawFeeBps: '100' }),
      ev('TreasuryUpdated', 11, { treasury: addr(1) }),
      ev('FeesUpdated', 12, { donationFeeBps: '300', withdrawFeeBps: '50' }),
    ])
    const fees = out.filter((c) => c.kind === 'FeesUpdated')
    // Newest first, and the newer change's old value is the older change's new value, as percentages.
    expect(fees[0]).toMatchObject({ blockNumber: 12n, old: '2.5% on gifts, 1% on withdrawals', next: '3% on gifts, 0.5% on withdrawals' })
  })

  it('marks the first change of each kind with old null', () => {
    const out = settingChanges([
      ev('TreasuryUpdated', 10, { treasury: addr(1) }),
      ev('CreationPausedSet', 11, { paused: true }),
      ev('CreationPausedSet', 12, { paused: false }),
    ])
    expect(out.find((c) => c.kind === 'TreasuryUpdated')?.old).toBeNull()
    expect(out.find((c) => c.kind === 'CreationPausedSet' && c.blockNumber === 11n)?.old).toBeNull()
    expect(out.find((c) => c.kind === 'CreationPausedSet' && c.blockNumber === 12n)).toMatchObject({ old: 'Paused', next: 'Not paused' })
  })

  it('uses the event fields for CampaignCreatorChanged', () => {
    const out = settingChanges([
      ev('CampaignCreatorChanged', 10, { campaign: addr(5), oldCreator: addr(6), newCreator: addr(7) }),
      ev('CampaignCreatorChanged', 11, { campaign: addr(8), oldCreator: addr(9), newCreator: addr(10) }),
    ])
    // A different Fundit's change is not the "previous" one: each carries its own old creator.
    expect(out[0]).toMatchObject({ fundit: addr(8), old: addr(9), next: addr(10) })
    expect(out[1]).toMatchObject({ fundit: addr(5), old: addr(6), next: addr(7) })
  })

  it('leaves out gift events', () => {
    const out = settingChanges([
      { ...ev('Donated', 9, { amount: '5' }), address: addr(1) },
      { ...ev('FeesClaimed', 9, { amount: '5' }), address: addr(1) },
      ev('EurcPayoutDomainSet', 10, { domain: '26' }),
    ])
    expect(out.map((c) => c.kind)).toEqual(['EurcPayoutDomainSet'])
  })
})
