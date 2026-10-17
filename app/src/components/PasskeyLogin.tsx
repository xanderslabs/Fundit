import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useWalletChoice } from '../hooks/useSender'
import { explainError } from '../lib/errors'
import { shortAddress } from '../lib/names'
import { loginPasskey, logoutPasskey, registerPasskey, type StoredPasskey, usePasskeySession } from '../lib/passkey'

export const PASSKEY_INTRO =
  'A passkey lets you sign in with your fingerprint, face or device PIN, with no wallet app to install. It opens a Fundit wallet on Arc that you add USDC to before you donate.'

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
        Log in with a passkey
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

// The logged-in passkey wallet. With a connected wallet as well, it says which one acts and offers the switch.
function PasskeySession({ session }: { session: StoredPasskey }) {
  const choice = useWalletChoice()
  return (
    <div className="passkey-menu">
      <Link to="/fund" className="btn btn-outline" title="Your passkey wallet">
        Passkey {shortAddress(session.address)}
      </Link>
      {choice.both && (
        <>
          <span className="hint">In use: {choice.active === 'passkey' ? 'passkey wallet' : 'connected wallet'}</span>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => choice.setActive(choice.active === 'passkey' ? 'external' : 'passkey')}
          >
            {choice.active === 'passkey' ? 'Use connected wallet' : 'Use passkey wallet'}
          </button>
        </>
      )}
      <button type="button" className="btn btn-outline" onClick={() => logoutPasskey()}>
        Log out
      </button>
    </div>
  )
}

// The header entry: the passkey wallet when logged in, otherwise a button that opens the sign-in panel.
export function PasskeyMenu() {
  const session = usePasskeySession()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  // Focus moves into the panel when it opens, to its first field.
  useEffect(() => {
    if (open) popover.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [open])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    setOpen(false)
    trigger.current?.focus()
  }

  if (session) return <PasskeySession session={session} />
  return (
    <div className="passkey-menu" onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="btn btn-outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Use a passkey
      </button>
      {open && (
        <div ref={popover} className="passkey-popover panel">
          <PasskeyLogin
            onDone={() => {
              setOpen(false)
              navigate('/fund')
            }}
          />
        </div>
      )}
    </div>
  )
}
