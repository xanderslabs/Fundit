import type { ScanEvent } from './historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'
import type { FunditSnapshot } from './snapshot'
import type { ByToken } from './stats'

// Gift figures from the history scan's events. Settings events are skipped. The gift message is never kept.
export function giftStats(events: ScanEvent[], rows: FunditSnapshot[], showTest: boolean, network: AdminNetwork) {
  const { testCreators } = ADMIN_NETWORKS[network]
  const byFundit = new Map(rows.map((r) => [r.address.toLowerCase(), r]))
  const zero = (): ByToken => ({ USDC: 0n, EURC: 0n })
  const total = zero()
  const count = { USDC: 0n, EURC: 0n }
  const tips = zero()
  const fees = zero()
  const feesClaimed = zero()
  const perDonor = new Map<string, number>()
  let gifts = 0

  for (const e of events) {
    if (e.kind !== 'Donated' && e.kind !== 'FeesClaimed') continue
    const row = byFundit.get(e.address.toLowerCase())
    if (!row || (!showTest && row.isTest)) continue
    const a = e.args
    if (e.kind === 'FeesClaimed') {
      feesClaimed[row.token] += BigInt(a.amount as string)
      continue
    }
    const donor = (a.donor as string).toLowerCase()
    if (!showTest && testCreators.includes(donor)) continue
    gifts++
    perDonor.set(donor, (perDonor.get(donor) ?? 0) + 1)
    const amount = BigInt(a.amount as string)
    total[row.token] += amount
    count[row.token] += 1n
    tips[row.token] += BigInt(a.tip as string)
    fees[row.token] += BigInt(a.fee as string)
  }

  const averageGift = zero()
  for (const t of ['USDC', 'EURC'] as const) if (count[t] > 0n) averageGift[t] = total[t] / count[t]
  return {
    gifts,
    uniqueDonors: perDonor.size,
    repeatDonors: [...perDonor.values()].filter((n) => n >= 2).length,
    averageGift,
    tips,
    fees,
    feesClaimed,
  }
}
