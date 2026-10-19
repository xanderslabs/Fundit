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

// Width rule: the one action that completes a card's form or task is block (full width), set with the prop;
// supporting actions (Max, Remove, Check again, Dismiss) keep their natural width. In a pair, the primary that
// completes the card is still block and the secondary (Later) sits under it at its natural width. Actions in a
// Banner, a StatusBox notice, a PageHeader or an EmptyState are not card actions and keep their natural width.
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
