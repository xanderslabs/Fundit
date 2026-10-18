import type { ReactNode } from 'react'
import './EmptyState.css'

// Shown when a list has nothing in it yet: a short line and an optional next step.
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-text">{children}</div>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}
