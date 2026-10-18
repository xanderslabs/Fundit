import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

export type TabItem = { id: string; label: string; content: ReactNode }

type Props = {
  label: string
  tabs: TabItem[]
  // Keeps a panel mounted (hidden) once it has been opened, so a form keeps its state, including a send in flight.
  keepMounted?: boolean
  className?: string
}

// The ARIA tabs pattern with automatic activation: only the selected tab is in the Tab order, the arrow keys move
// and select (wrapping at the ends), and Home and End jump to the first and last tab.
export function Tabs({ label, tabs, keepMounted = false, className }: Props) {
  const base = useId()
  const [active, setActive] = useState(tabs[0]!.id)
  const [visited, setVisited] = useState<string[]>([])
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const current = tabs.some((t) => t.id === active) ? active : tabs[0]!.id
  if (keepMounted && !visited.includes(current)) setVisited([...visited, current])

  const tabId = (id: string) => `${base}-tab-${id}`
  const panelId = (id: string) => `${base}-panel-${id}`
  const rendered = (id: string) => id === current || (keepMounted && visited.includes(id))

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = tabs.length
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % n
    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    setActive(tabs[next]!.id)
    buttons.current[next]?.focus()
  }

  return (
    <div className={className ? `tabs ${className}` : 'tabs'}>
      <div role="tablist" aria-label={label} className="tab-list">
        {tabs.map((t, i) => {
          const selected = t.id === current
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[i] = el
              }}
              id={tabId(t.id)}
              type="button"
              role="tab"
              className="tab"
              aria-selected={selected}
              aria-controls={rendered(t.id) ? panelId(t.id) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tabs.map((t) =>
        rendered(t.id) ? (
          <div key={t.id} id={panelId(t.id)} role="tabpanel" aria-labelledby={tabId(t.id)} tabIndex={0} className="tab-panel" hidden={t.id !== current}>
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  )
}
