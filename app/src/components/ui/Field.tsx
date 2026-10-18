import { Children, cloneElement, type InputHTMLAttributes, isValidElement, type ReactElement, type ReactNode } from 'react'
import './Field.css'

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid'] }

// A label, an optional hint and error, and one control (input, select, textarea or AmountInput). The control
// gets its id, and aria-describedby and aria-invalid are wired to the hint and error. Any aria-describedby the
// control already has is kept.
export function Field({ label, hint, error, id, children }: { label: string; hint?: ReactNode; error?: string; id: string; children: ReactNode }) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const control = Children.only(children)
  const wired = isValidElement<ControlProps>(control)
    ? cloneElement(control as ReactElement<ControlProps>, {
        id,
        'aria-describedby':
          [control.props['aria-describedby'], hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : control.props['aria-invalid'],
      })
    : control
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      {wired}
      {hint && (
        <p id={hintId} className="ui-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="ui-field-error">
          {error}
        </p>
      )}
    </div>
  )
}

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'> & {
  id: string
  value: string
  onChange: InputHTMLAttributes<HTMLInputElement>['onChange']
  currency: string
}

// A decimal amount with the currency shown inside the box. The currency is decoration: the label says what
// the field is for.
export function AmountInput({ id, value, onChange, currency, className, ...rest }: AmountInputProps) {
  return (
    <div className="ui-amount">
      <input
        inputMode="decimal"
        autoComplete="off"
        {...rest}
        id={id}
        value={value}
        onChange={onChange}
        className={['ui-input', 'ui-amount-input', className].filter(Boolean).join(' ')}
      />
      <span className="ui-amount-currency" aria-hidden="true">
        {currency}
      </span>
    </div>
  )
}
