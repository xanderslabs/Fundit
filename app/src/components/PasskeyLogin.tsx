import { type FormEvent, type Ref, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { Link } from 'react-router'
import { explainError, isInvalidUsername, isUserRejection, USERNAME_PATTERN, USERNAME_RULE, USERNAME_TAKEN } from '../lib/errors'
import { formatAmount } from '../lib/format'
import { shortAddress } from '../lib/names'
import { type AccountChoice, chooseAccount, loginPasskey, registerPasskey } from '../lib/passkey'
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

// Under the passkey button in both views: what a passkey is, for someone who has not used one.
const PASSKEY_NOTE = 'Your passkey stays with you, on your device or in your password manager. Fundit can never see it or act for you.'

const accountLabel = (o: AccountChoice['options'][number]) => `${shortAddress(o.address)} (balance ${formatAmount(o.usdc, 'USDC')})`

// Another account lists this passkey as an owner (a recovered account, most likely). It opens only once the person
// says so: anyone can add a passkey's public key to their own account.
function ChooseAccount({ choice, busy, first, pick }: { choice: AccountChoice; busy: boolean; first: Ref<HTMLButtonElement>; pick: (a: Address) => void }) {
  const [only] = choice.options
  if (choice.options.length === 1 && only) {
    return (
      <>
        <p className="passkey-question">{`This passkey can also open account ${accountLabel(only)}. Is this the account you recovered?`}</p>
        <Button ref={first} size="lg" block disabled={busy} onClick={() => pick(only.address)}>
          Yes, open it
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy} onClick={() => pick(choice.own)}>
          No, use a new account
        </Button>
      </>
    )
  }
  return (
    <>
      <p className="passkey-question">This passkey can open more than one account. Pick the one you recovered.</p>
      {choice.options.map((o, i) => (
        <Button key={o.address} ref={i === 0 ? first : undefined} variant="secondary" size="lg" block disabled={busy} onClick={() => pick(o.address)}>
          {`Open ${accountLabel(o)}`}
        </Button>
      ))}
      <Button variant="secondary" size="lg" block disabled={busy} onClick={() => pick(choice.own)}>
        Use a new account
      </Button>
    </>
  )
}

// Sign in with a passkey already on this device, or switch to the create view and sign up with a username.
// headingId names the heading for a dialog that wraps this. onLeave runs when the recovery link is followed.
export function PasskeyLogin({ onDone, onLeave, headingId }: { onDone?: () => void; onLeave?: () => void; headingId?: string }) {
  const [view, setView] = useState<View>('signin')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [choice, setChoice] = useState<AccountChoice | null>(null)
  const switched = useRef(false)
  const signInButton = useRef<HTMLButtonElement>(null)
  const firstChoice = useRef<HTMLButtonElement>(null)
  const usernameField = useRef<HTMLInputElement>(null)
  const name = username.trim()
  const nameError = tried && name === '' ? 'Enter a name for your account.' : usernameError(name, tried)

  // The old view's controls are gone after a switch, so focus moves to the new view's first control.
  useEffect(() => {
    if (!switched.current) return
    ;(view === 'create' ? usernameField : signInButton).current?.focus()
  }, [view])

  // The sign-in button is gone once the choice shows, so focus moves to its first answer.
  useEffect(() => {
    if (choice) firstChoice.current?.focus()
  }, [choice])

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
      const res = await action()
      if (res && typeof res === 'object' && 'status' in res && res.status === 'choose') {
        setChoice(res as AccountChoice)
        return
      }
      setChoice(null)
      onDone?.()
    } catch (err) {
      // Sign-up can fail after the browser saved the passkey. That passkey still opens the account.
      // A refused or taken name means Circle never asked the browser for a passkey.
      const message = explainError(err)
      const refusedName = isInvalidUsername(err) || message === USERNAME_TAKEN
      const retry = registering && !isUserRejection(err) && !refusedName ? ' If your browser saved a passkey, sign in with it.' : ''
      setError(message + retry)
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
        {choice ? 'Which account?' : view === 'signin' ? 'Sign in' : 'Create your account'}
      </h2>
      {choice ? (
        <ChooseAccount choice={choice} busy={busy} first={firstChoice} pick={(a) => void run(() => chooseAccount(a))} />
      ) : view === 'signin' ? (
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
      {!choice && <p className="passkey-note">{PASSKEY_NOTE}</p>}
      {busy && <p className="passkey-hint">Follow the steps your browser shows.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!choice && (
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
      )}
    </div>
  )
}
