import type { ReactNode } from 'react'
import './StatusBox.css'

// Transaction progress and results. It has no live role of its own: put it inside the caller's aria-live
// region (as TxStatus does), which must be in the page before the box appears for the change to be read out.
export function StatusBox({ tone = 'info', children }: { tone?: 'info' | 'success' | 'error'; children: ReactNode }) {
  return <div className={`ui-status ui-status-${tone}`}>{children}</div>
}
