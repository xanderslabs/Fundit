import { type FormEvent, useState } from 'react'
import { explainError, isInvalidUsername, isUserRejection, USERNAME_PATTERN, USERNAME_RULE } from '../lib/errors'
import { loginPasskey, registerPasskey } from '../lib/passkey'

export const PASSKEY_INTRO =
  'A passkey lets you sign in with your fingerprint, face or device PIN, with no wallet app to install. It opens a Fundit account on Arc that you add USDC to before you give.'

export const MAX_USERNAME = 50

// Circle's username rule (see USERNAME_PATTERN). A wrong character shows at once; too short only on submit.
export function usernameError(name: string, submitted: boolean): string | null {
  if (name === '') return null
  if (name.length > MAX_USERNAME || /[^A-Za-z0-9_@.:+-]/.test(name)) return USERNAME_RULE
  return submitted && !USERNAME_PATTERN.test(name) ? USERNAME_RULE : null
}

// Sign up with a username, or log in with a passkey already on this device.
export function PasskeyLogin({ onDone }: { onDone?: () => void }) {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const name = username.trim()
  const nameError = tried && name === '' ? 'Enter a name for your account.' : usernameError(name, tried)

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
      <p className="hint">{PASSKEY_INTRO}</p>
      <form className="passkey-form" onSubmit={signUp} noValidate>
        <div className="form-field">
          <label htmlFor="passkey-username">Name for your passkey</label>
          <input
            id="passkey-username"
            autoComplete="username webauthn"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            aria-invalid={nameError ? true : undefined}
          />
          <p className="hint">Only you see this. It helps you pick the right passkey later. {USERNAME_RULE}</p>
          {nameError && (
            <p className="field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <button type="submit" className="btn" disabled={busy}>
          Create my Fundit account
        </button>
      </form>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void run(() => loginPasskey())}>
        Sign in with a passkey
      </button>
      {busy && <p className="hint">Follow the steps your browser shows.</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
