import type { ReactNode } from 'react'
import './Actions.css'

// The row for a card's or dialog's main action and its one secondary action (see the width rule in Button.tsx).
// Put the secondary first and the primary last: they sit side by side at equal widths, and below 400px they
// stack full width with the primary on top.
export function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ui-actions', className].filter(Boolean).join(' ')}>{children}</div>
}
