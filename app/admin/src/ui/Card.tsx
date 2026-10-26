import { type ReactNode, useEffect, useState } from 'react'
import { Badge, Button, Card as BaseCard } from '../../../src/components/ui'
import { RefreshIcon } from './icons'

// "Updated 5 s ago", in whole seconds, minutes, hours or days.
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

// Re-renders every few seconds so "Updated X ago" and the stale mark keep up.
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

// One card on a panel page. It loads and fails on its own: a skeleton while loading, "Couldn't load this." with
// Try again on error. A card that already has data keeps showing it while it refreshes (pass state "ready").
// The footer says how old the data is and where it came from, and marks it stale past staleAfterMs.
export function Card({
  title,
  updatedAt,
  staleAfterMs,
  source,
  onRefresh,
  state,
  onRetry,
  children,
}: {
  title: string
  updatedAt?: number
  staleAfterMs?: number
  source?: string
  onRefresh?(): void
  state: 'loading' | 'error' | 'ready'
  onRetry?(): void
  children?: ReactNode
}) {
  const now = useNow(updatedAt !== undefined)
  const stale = updatedAt !== undefined && staleAfterMs !== undefined && now - updatedAt > staleAfterMs
  const footer = state === 'ready' && (updatedAt !== undefined || source)

  return (
    <BaseCard className="admin-card" label={title}>
      <div className="admin-card-head">
        <h2 className="admin-card-title">{title}</h2>
        {onRefresh && (
          <button type="button" className="admin-icon-button admin-icon-button-sm" aria-label={`Refresh ${title}`} onClick={onRefresh}>
            <RefreshIcon />
          </button>
        )}
      </div>
      <div className="admin-card-body" aria-busy={state === 'loading' || undefined}>
        {state === 'loading' && (
          <div className="admin-skeleton" aria-hidden="true">
            <span className="admin-skeleton-line" />
            <span className="admin-skeleton-line admin-skeleton-short" />
          </div>
        )}
        {state === 'loading' && <span className="sr-only">Loading</span>}
        {state === 'error' && (
          <div className="admin-card-error" role="alert">
            <p>Couldn't load this.</p>
            {onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        )}
        {state === 'ready' && children}
      </div>
      {footer && (
        <p className="admin-card-foot">
          {updatedAt !== undefined && <span>Updated {ago(now - updatedAt)}</span>}
          {stale && <Badge tone="attention">Stale</Badge>}
          {source && <span className="admin-card-source">{source}</span>}
        </p>
      )}
    </BaseCard>
  )
}
