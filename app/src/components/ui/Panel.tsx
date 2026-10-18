import { type ReactNode, useId } from 'react'
import { CloseIcon } from './CloseIcon'
import './Panel.css'

// A raised card with a title, an optional description and an optional Close button (Add money, Send).
export function Panel({
  title,
  description,
  onClose,
  headingId,
  children,
}: {
  title: string
  description?: ReactNode
  onClose?: () => void
  headingId?: string
  children: ReactNode
}) {
  const fallbackId = useId()
  const id = headingId ?? fallbackId
  return (
    <section className="ui-panel" aria-labelledby={id}>
      <div className="ui-panel-head">
        <h2 id={id} className="ui-panel-title">
          {title}
        </h2>
        {onClose && (
          <button type="button" className="ui-panel-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>
      {description && <div className="ui-panel-description">{description}</div>}
      <div className="ui-panel-body">{children}</div>
    </section>
  )
}
