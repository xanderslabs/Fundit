import type { ReactNode } from 'react'
import './PageHeader.css'

// The top of a page: the h1, an optional subtitle and optional actions. width matches the page below it.
export function PageHeader({
  title,
  subtitle,
  actions,
  width = 'page',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  width?: 'narrow' | 'page' | 'wide'
}) {
  return (
    <header className={`ui-page-header ui-page-header-${width}`}>
      <div className="ui-page-header-text">
        <h1 className="ui-page-title">{title}</h1>
        {subtitle && <div className="ui-page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  )
}
