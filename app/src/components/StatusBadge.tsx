import type { Summary } from '../lib/campaigns'
import { Badge } from './ui'

export function campaignStatus(summary: Summary): 'Closed' | 'Goal reached' | 'Open' {
  if (summary.closed) return 'Closed'
  if (summary.goal > 0n && summary.raised >= summary.goal) return 'Goal reached'
  return 'Open'
}

// Open is green, as before. Goal reached stands out in the attention tone. Closed is plain.
export function StatusBadge({ summary }: { summary: Summary }) {
  const status = campaignStatus(summary)
  const tone = status === 'Closed' ? 'neutral' : status === 'Goal reached' ? 'attention' : 'success'
  return <Badge tone={tone}>{status}</Badge>
}
