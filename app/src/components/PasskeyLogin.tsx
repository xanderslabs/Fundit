import { type FormEvent, useState } from 'react'
import { explainError } from '../lib/errors'
import { loginPasskey, registerPasskey } from '../lib/passkey'

export const PASSKEY_INTRO =
  'A passkey lets you sign in with your fingerprint, face or device PIN, with no wallet app to install. It opens a Fundit wallet on Arc that you add USDC to before you give.'

const MAX_USERNAME = 50

// Sign up with a username, or log in with a passkey already on this device.
export function PasskeyLogin({ onDone }: { onDone?: () => void }) {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = username.trim()
  const nameError = name.length > MAX_USERNAME ? `Keep the name to ${MAX_USERNAME} characters.` : null

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone?.()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  function signUp(e: FormEvent) {
    e.preventDefault()
    if (name === '' || nameError) return
    void run(() => registerPasskey(name))
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
          <p className="hint">Only you see this. It helps you pick the right passkey later.</p>
          {nameError && (
            <p className="field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <button type="submit" className="btn" disabled={busy || name === '' || nameError !== null}>
          Create a passkey wallet
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
