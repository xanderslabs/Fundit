import type { ReactNode } from 'react'
import './Card.css'

// raised: white with a border, for content that sits on the page. muted: the soft grey surface.
export function Card({
  tone = 'raised',
  as: Tag = 'section',
  className,
  label,
  children,
}: {
  tone?: 'raised' | 'muted'
  as?: 'section' | 'div' | 'article'
  className?: string
  // The accessible name. A section with a name is a region landmark.
  label?: string
  children: ReactNode
}) {
  return (
    <Tag className={['ui-card', `ui-card-${tone}`, className].filter(Boolean).join(' ')} aria-label={label}>
      {children}
    </Tag>
  )
}
