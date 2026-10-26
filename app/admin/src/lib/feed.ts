import type { Address, Hex } from 'viem'
import { formatAmount } from '../../../src/lib/format'
import { shortAddress } from '../../../src/lib/names'
import type { ScanEvent } from './historyScan'
import type { FunditSnapshot } from './snapshot'

export type FeedItem = {
  kind: 'gift' | 'newFundit' | 'setting'
  blockNumber: bigint
  logIndex: number
  txHash?: Hex
  address: Address
  text: string
}

function name(row: FunditSnapshot): string {
  return row.title.trim() || shortAddress(row.address)
}

// One plain line per settings change.
function settingText(e: ScanEvent): string | null {
  const a = e.args
  switch (e.kind) {
    case 'FeesUpdated':
      return `Fees set to ${a.donationFeeBps} bps on gifts and ${a.withdrawFeeBps} bps on withdrawals`
    case 'TreasuryUpdated':
      return `Treasury changed to ${shortAddress(a.treasury as string)}`
    case 'FeaturedUpdated':
      return /^0x0+$/.test(a.campaign as string) ? 'Featured Fundit cleared' : `Featured Fundit set to ${shortAddress(a.campaign as string)}`
    case 'CreationPausedSet':
      return a.paused ? 'New Fundits paused' : 'New Fundits unpaused'
    case 'EurcPayoutDomainSet':
      return `EURC payout domain set to ${a.domain}`
    case 'CampaignCreatorChanged':
      return `Creator of ${shortAddress(a.campaign as string)} changed to ${shortAddress(a.newCreator as string)}`
    case 'OwnershipTransferStarted':
      return `Ownership transfer to ${shortAddress(a.newOwner as string)} started`
    case 'OwnershipTransferred':
      return `Ownership moved to ${shortAddress(a.newOwner as string)}`
    default:
      return null
  }
}

// The newest limit items from gifts, new Fundits and settings changes, newest first. Only gifts to Fundits in rows
// are kept, so passing the visible rows hides gifts to hidden test Fundits. A new Fundit sorts before anything else
// in its creation block (logIndex -1), as its creation log comes first.
export function latestFeed(events: ScanEvent[], snapshot: FunditSnapshot[], limit: number): FeedItem[] {
  const byAddress = new Map(snapshot.map((r) => [r.address.toLowerCase(), r]))
  const items: FeedItem[] = snapshot.map((r) => ({
    kind: 'newFundit',
    blockNumber: r.createdAtBlock,
    logIndex: -1,
    address: r.address,
    text: `New Fundit: ${name(r)}`,
  }))
  for (const e of events) {
    if (e.kind === 'Donated') {
      const row = byAddress.get(e.address.toLowerCase())
      if (!row) continue
      const text = `Gift of ${formatAmount(BigInt(e.args.amount as string), row.token)} to ${name(row)}`
      items.push({ kind: 'gift', blockNumber: e.blockNumber, logIndex: e.logIndex, txHash: e.txHash, address: e.address, text })
      continue
    }
    const text = settingText(e)
    if (text) items.push({ kind: 'setting', blockNumber: e.blockNumber, logIndex: e.logIndex, txHash: e.txHash, address: e.address, text })
  }
  items.sort((x, y) => (x.blockNumber !== y.blockNumber ? (x.blockNumber > y.blockNumber ? -1 : 1) : y.logIndex - x.logIndex))
  return items.slice(0, limit)
}
