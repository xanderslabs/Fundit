import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { explainError, isInvalidUsername, isUserRejection, USERNAME_PATTERN, USERNAME_RULE } from '../lib/errors'
import { loginPasskey, registerPasskey } from '../lib/passkey'
import { Button, Field } from './ui'
import './Form.css'
import './PasskeyLogin.css'

export const MAX_USERNAME = 50

// Circle's username rule (see USERNAME_PATTERN). A wrong character shows at once; too short only on submit.
export function usernameError(name: string, submitted: boolean): string | null {
  if (name === '') return null
  if (name.length > MAX_USERNAME || /[^A-Za-z0-9_@.:+-]/.test(name)) return USERNAME_RULE
  return submitted && !USERNAME_PATTERN.test(name) ? USERNAME_RULE : null
}

type View = 'signin' | 'create'

// Sign in with a passkey already on this device, or switch to the create view and sign up with a username.
// headingId names the heading for a dialog that wraps this. onLeave runs when the recovery link is followed.
export function PasskeyLogin({ onDone, onLeave, headingId }: { onDone?: () => void; onLeave?: () => void; headingId?: string }) {
  const [view, setView] = useState<View>('signin')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const switched = useRef(false)
  const signInButton = useRef<HTMLButtonElement>(null)
  const usernameField = useRef<HTMLInputElement>(null)
  const name = username.trim()
  const nameError = tried && name === '' ? 'Enter a name for your account.' : usernameError(name, tried)

  // The old view's controls are gone after a switch, so focus moves to the new view's first control.
  useEffect(() => {
    if (!switched.current) return
    ;(view === 'create' ? usernameField : signInButton).current?.focus()
  }, [view])

  function switchTo(next: View) {
    switched.current = true
    setError(null)
    setTried(false)
    setView(next)
  }

  async function run(action: () => Promise<unknown>, registering = false) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone?.()
    } catch (err) {
      // Sign-up can fail after the browser saved the passkey. That passkey still opens the account.
      // A refused name means Circle never asked the browser for a passkey.
      const retry = registering && !isUserRejection(err) && !isInvalidUsername(err) ? ' If your browser saved a passkey, sign in with it.' : ''
      setError(explainError(err) + retry)
    } finally {
      setBusy(false)
    }
  }

  function signUp(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (name === '' || usernameError(name, true)) return
    void run(() => registerPasskey(name), true)
  }

  return (
    <div className="passkey-login">
      <h2 id={headingId} className="ui-dialog-title">
        {view === 'signin' ? 'Sign in' : 'Create your account'}
      </h2>
      {view === 'signin' ? (
        <Button ref={signInButton} size="lg" block disabled={busy} onClick={() => void run(() => loginPasskey())}>
          Sign in with your passkey
        </Button>
      ) : (
        <form className="passkey-form" onSubmit={signUp} noValidate>
          <div className="passkey-field">
            <Field id="passkey-username" label="Username" hint="5 to 50 characters, no spaces">
              <input
                ref={usernameField}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                aria-invalid={nameError ? true : undefined}
              />
            </Field>
            {nameError && (
              <p className="form-error" role="alert">
                {nameError}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" block disabled={busy}>
            Create account
          </Button>
        </form>
      )}
      {busy && <p className="passkey-hint">Follow the steps your browser shows.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="passkey-alt">
        {view === 'signin' ? (
          <p>
            {"Don't have an account? "}
            <button type="button" className="link-button" disabled={busy} onClick={() => switchTo('create')}>
              Create one now
            </button>
          </p>
        ) : (
          <p>
            {'Already have an account? '}
            <button type="button" className="link-button" disabled={busy} onClick={() => switchTo('signin')}>
              Sign in now
            </button>
          </p>
        )}
        <p>
          {'Lost access to your account? '}
          <Link to="/recover" onClick={onLeave}>
            Recover it now
          </Link>
        </p>
      </div>
    </div>
  )
}
