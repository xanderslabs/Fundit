import type { ComponentPropsWithRef } from 'react'
import { Link, type LinkProps } from 'react-router'
import './Button.css'

type Look = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg'
  // Full width of its container.
  block?: boolean
}

function classes({ variant = 'primary', size = 'md', block = false }: Look, extra?: string): string {
  return ['ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, block && 'ui-btn-block', extra].filter(Boolean).join(' ')
}

type ButtonProps = Look & ComponentPropsWithRef<'button'> & { loading?: boolean }

// Width rule: a card or dialog with ONE main action makes it block (full width), set with the prop. A main
// action with one secondary action (Later, Start over, Remove) goes in an Actions row instead, secondary first
// and primary last: side by side at equal widths, stacked full width with the primary on top below 400px.
// Neither button in an Actions row is block. Supporting actions inside a form (Max, Try again) keep their
// natural width. Actions in a Banner, a StatusBox notice, a PageHeader or an EmptyState are not card actions
// and keep their natural width.
// A busy button is disabled, so a send cannot go out twice. type defaults to "button" so a button in a form
// never submits it by accident.
export function Button({ variant, size, block, loading = false, disabled, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

// A link that looks like a button, for moving to another page.
export function ButtonLink({ variant, size, block, className, ...rest }: Look & LinkProps) {
  return <Link {...rest} className={classes({ variant, size, block }, className)} />
}
