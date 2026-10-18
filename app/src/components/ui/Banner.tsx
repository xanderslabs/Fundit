import type { ReactNode } from 'react'
import './Banner.css'

// A message across the page, with an optional action (the recovery key reminder).
export function Banner({ tone = 'info', action, children }: { tone?: 'info' | 'attention'; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`ui-banner ui-banner-${tone}`}>
      <div className="ui-banner-text">{children}</div>
      {action && <div className="ui-banner-action">{action}</div>}
    </div>
  )
}
