import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { CloseIcon } from './CloseIcon'
import './Dialog.css'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// A modal dialog, ported from the sign-in dialog in AccountMenu. Focus moves to its first control and stays
// inside: Tab wraps at the ends. Escape, a click on the backdrop and the Close button all close it. When it closes,
// focus goes back to the element that had it when the dialog opened.
// Name it with title (the dialog renders an h2) or with labelledBy, the id of a heading its children render.
// A child heading takes the ui-dialog-title class, so every dialog title looks the same.
type Name = { title: string; labelledBy?: never } | { labelledBy: string; title?: never }
// size: sm for short content (sign-in), md for longer content (sharing). Default md.
type DialogProps = Name & { open: boolean; onClose: () => void; size?: 'sm' | 'md'; children: ReactNode }

export function Dialog({ open, ...rest }: DialogProps) {
  if (!open) return null
  return <OpenDialog {...rest} />
}

function OpenDialog({ onClose, size = 'md', title, labelledBy, children }: Omit<DialogProps, 'open'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const ownHeadingId = useId()
  const headingId = labelledBy ?? ownHeadingId

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const opener = document.activeElement as HTMLElement | null
    if (typeof d.showModal === 'function' && !d.open) d.showModal()
    else d.setAttribute('open', '')
    d.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    // The native dialog is closed first, so the page behind is no longer inert when focus goes back to it.
    return () => {
      if (d.open && typeof d.close === 'function') d.close()
      opener?.focus()
    }
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const list = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return
    const active = document.activeElement as HTMLElement | null
    const inside = active !== null && list.includes(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialog}
      className={`ui-dialog ui-dialog-${size}`}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === dialog.current) onClose()
      }}
    >
      <div className="ui-dialog-body">
        {title !== undefined && (
          <h2 id={headingId} className="ui-dialog-title">
            {title}
          </h2>
        )}
        {children}
        <button type="button" className="ui-dialog-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
    </dialog>
  )
}
