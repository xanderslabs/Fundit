import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

export type MenuItem = {
  label: string
  onSelect(): void
  // A link opens in a new tab (the explorer).
  href?: string
  // Shown but not chosen, with the reason under the label.
  disabled?: boolean
  hint?: string
  // The current choice, marked with a dot.
  current?: boolean
}

// A button that opens a list of actions (the ARIA menu button pattern). Opening focuses the first item; Arrow Up
// and Arrow Down move between items, wrapping at the ends; Escape, Tab and a click outside close it and give focus
// back to the button. label is the button's accessible name; trigger is what it shows.
export function Menu({ label, trigger, items, align = 'end', className }: { label: string; trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()

  const entries = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  function close(refocus = true) {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    entries()[0]?.focus()
    // A click outside closes it. Focus goes back to the button unless the click put it on another control.
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (list.current?.contains(t) || button.current?.contains(t)) return
      const elsewhere = document.activeElement && document.activeElement !== document.body
      close(!elsewhere)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [open])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = entries()
    const i = all.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (e.key === 'ArrowDown') next = (i + 1) % all.length
    else if (e.key === 'ArrowUp') next = (i - 1 + all.length) % all.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = all.length - 1
    else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    } else if (e.key === 'Tab') {
      close(false)
      return
    }
    if (next === null) return
    e.preventDefault()
    all[next]?.focus()
  }

  function choose(item: MenuItem) {
    if (item.disabled) return
    close()
    item.onSelect()
  }

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className={['admin-menu', className].filter(Boolean).join(' ')}>
      <button
        ref={button}
        type="button"
        className="admin-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
      >
        {trigger}
      </button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} className={`admin-menu-list admin-menu-${align}`} onKeyDown={onKeyDown}>
          {items.map((item) => {
            const content = (
              <>
                <span className="admin-menu-mark" aria-hidden="true">
                  {item.current ? <span className="admin-menu-dot" /> : null}
                </span>
                <span className="admin-menu-text">
                  <span className="admin-menu-label">{item.label}</span>
                  {item.hint && <span className="admin-menu-hint">{item.hint}</span>}
                </span>
              </>
            )
            const common = {
              role: 'menuitem',
              tabIndex: -1,
              className: 'admin-menu-item',
              'aria-disabled': item.disabled || undefined,
              'aria-current': item.current || undefined,
            } as const
            return item.href && !item.disabled ? (
              <a key={item.label} {...common} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => choose(item)}>
                {content}
              </a>
            ) : (
              <button key={item.label} {...common} type="button" onClick={() => choose(item)}>
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
