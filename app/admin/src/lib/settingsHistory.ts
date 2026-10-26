import type { Address, Hex } from 'viem'
import type { ScanEvent } from './historyScan'

// A setting change read from a factory event. old is the previous event of the same kind, or null for the first
// (the factory does not say what a setting was before its first event). CampaignCreatorChanged is the exception:
// it names the Fundit and carries both creators itself. Values are text, ready to show: fees as percentages,
// addresses as given.
export type SettingChange = {
  kind: ScanEvent['kind']
  blockNumber: bigint
  txHash: Hex
  old: string | null
  next: string
  fundit?: Address
}

const GIFT_KINDS: readonly ScanEvent['kind'][] = ['Donated', 'FeesClaimed']
const ZERO = /^0x0+$/

// 250 bps is "2.5%".
function percent(bps: string): string {
  return `${Number(bps) / 100}%`
}

function value(e: ScanEvent): string {
  const a = e.args
  switch (e.kind) {
    case 'FeesUpdated':
      return `${percent(a.donationFeeBps as string)} on gifts, ${percent(a.withdrawFeeBps as string)} on withdrawals`
    case 'TreasuryUpdated':
      return a.treasury as string
    case 'FeaturedUpdated':
      return ZERO.test(a.campaign as string) ? 'None' : (a.campaign as string)
    case 'CreationPausedSet':
      return a.paused ? 'Paused' : 'Not paused'
    case 'EurcPayoutDomainSet':
      return a.domain as string
    case 'CampaignCreatorChanged':
      return a.newCreator as string
    default:
      return a.newOwner as string
  }
}

// Every factory setting change, newest first.
export function settingChanges(events: ScanEvent[]): SettingChange[] {
  const ordered = events
    .filter((e) => !GIFT_KINDS.includes(e.kind))
    .sort((x, y) => (x.blockNumber !== y.blockNumber ? (x.blockNumber < y.blockNumber ? -1 : 1) : x.logIndex - y.logIndex))
  const last = new Map<ScanEvent['kind'], string>()
  const out: SettingChange[] = []
  for (const e of ordered) {
    const next = value(e)
    if (e.kind === 'CampaignCreatorChanged') {
      out.push({ kind: e.kind, blockNumber: e.blockNumber, txHash: e.txHash, old: e.args.oldCreator as string, next, fundit: e.args.campaign as Address })
    } else {
      out.push({ kind: e.kind, blockNumber: e.blockNumber, txHash: e.txHash, old: last.get(e.kind) ?? null, next })
      last.set(e.kind, next)
    }
  }
  return out.reverse()
}
