import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'
import './Tabs.css'

const tabId = (id: string) => `${id}-tab`
const panelId = (id: string) => `${id}-panel`

// The ARIA tabs pattern with automatic activation: only the selected tab is in the Tab order, the arrow keys move
// and select (wrapping at the ends), and Home and End jump to the first and last tab. The tabs share the row and
// their labels wrap, so the list never scrolls sideways. Tab ids must be unique on the page: they name the tab
// and panel elements. Pair each tab with a TabPanel of the same id.
export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  label: string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = tabs.length
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (i + 1) % n
    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    onChange(tabs[next]!.id)
    buttons.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="ui-tab-list">
      {tabs.map((t, i) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[i] = el
            }}
            id={tabId(t.id)}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={selected}
            // Only the selected tab's panel is sure to be in the page.
            aria-controls={selected ? panelId(t.id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="ui-tab-label">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// A panel that is not active stays mounted but hidden, so a form keeps its state. Leave it out of the page to
// unmount it.
export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return (
    <div id={panelId(id)} role="tabpanel" aria-labelledby={tabId(id)} tabIndex={0} className="ui-tab-panel" hidden={!active}>
      {children}
    </div>
  )
}

export type TabItem = { id: string; label: string; content: ReactNode }

// Tabs that hold their own state and content (Add money uses them). keepMounted keeps a panel mounted (hidden)
// once it has been opened, so a form keeps its state, including a send in flight.
export function ContentTabs({
  label,
  tabs,
  keepMounted = false,
  className,
}: {
  label: string
  tabs: TabItem[]
  keepMounted?: boolean
  className?: string
}) {
  const base = useId()
  const [active, setActive] = useState(tabs[0]!.id)
  const [visited, setVisited] = useState<string[]>([])
  const current = tabs.some((t) => t.id === active) ? active : tabs[0]!.id
  if (keepMounted && !visited.includes(current)) setVisited([...visited, current])
  const rendered = (id: string) => id === current || (keepMounted && visited.includes(id))
  // useId gives each instance its own element ids, so two tab sets on one page never clash.
  const scoped = (id: string) => `${base}-${id}`

  return (
    <div className={className ? `ui-tabs ${className}` : 'ui-tabs'}>
      <Tabs
        label={label}
        tabs={tabs.map((t) => ({ id: scoped(t.id), label: t.label }))}
        value={scoped(current)}
        onChange={(id) => setActive(tabs.find((t) => scoped(t.id) === id)!.id)}
      />
      {tabs.map((t) =>
        rendered(t.id) ? (
          <TabPanel key={t.id} id={scoped(t.id)} active={t.id === current}>
            {t.content}
          </TabPanel>
        ) : null,
      )}
    </div>
  )
}
