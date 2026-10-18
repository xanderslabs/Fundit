import type { ReactNode } from 'react'
import './StatusBox.css'

// Transaction progress and results. It has no live role of its own: put it inside the caller's aria-live
// region (as TxStatus does), which must be in the page before the box appears for the change to be read out.
// className adds a hook class, such as one an e2e locator finds the box by.
export function StatusBox({ tone = 'info', className, children }: { tone?: 'info' | 'success' | 'error'; className?: string; children: ReactNode }) {
  return <div className={['ui-status', `ui-status-${tone}`, className].filter(Boolean).join(' ')}>{children}</div>
}
