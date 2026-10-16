import type { Summary } from '../lib/campaigns'

export function campaignStatus(summary: Summary): 'Closed' | 'Goal reached' | 'Open' {
  if (summary.closed) return 'Closed'
  if (summary.goal > 0n && summary.raised >= summary.goal) return 'Goal reached'
  return 'Open'
}

export function StatusBadge({ summary }: { summary: Summary }) {
  const status = campaignStatus(summary)
  const tone = status === 'Closed' ? 'muted' : status === 'Goal reached' ? 'done' : 'open'
  return <span className={`badge badge-${tone}`}>{status}</span>
}
