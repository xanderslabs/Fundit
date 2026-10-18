import type { ReactNode } from 'react'
import './Badge.css'

// A short status label, such as a Fundit's state.
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'attention'; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>
}
