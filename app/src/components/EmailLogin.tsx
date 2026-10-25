import { type FormEvent, useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '../config'
import { CIRCLE_CODE, EmailLoginStopped, loadCircleSdk, openEmailAccount, sendEmailCode } from '../lib/circleEmail'
import { EmailError, type EmailSession } from '../lib/emailAccount'
import { explainError } from '../lib/errors'
import { loadTurnstile, type Turnstile } from '../lib/turnstile'
import { Button, Field } from './ui'
import './Form.css'
import './SignInOptions.css'

export const WRONG_CODE = 'That code is not right. Check it and try again.'
export const EXPIRED_CODE = 'That code has expired. Send a new one.'
export const TOO_MANY_TRIES = 'Too many tries. Send a new code.'
export const TURNSTILE_FAILED = 'We could not check this browser. Try again.'
export const EMAIL_UNAVAILABLE = 'Email sign-in is not available right now. Use a wallet.'
const NEW_CODE = 'Press Send code to get a new code.'
const CHECK_PENDING = 'Wait a moment for the browser check to finish, then try again.'

// Circle's lockout after three wrong codes, and its "OTP is locked" code.
const LOCKED = [155146, 155141]
// The Worker's own email check (worker/index.ts), so a typo is caught before Turnstile is spent.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}$/

// Plain text for a failed email sign-in step.
export function emailErrorText(err: unknown): string {
  if (err instanceof EmailError) {
    if (err.code === CIRCLE_CODE.otpInvalid || err.code === CIRCLE_CODE.otpNotMatch) return WRONG_CODE
    if (err.code === 155130) return EXPIRED_CODE
    if (err.code !== null && LOCKED.includes(err.code)) return TOO_MANY_TRIES
    if (err.status === 403 && err.code === null && /turnstile/i.test(err.message)) return TURNSTILE_FAILED
    // No answer, the Worker or Circle down or not set up, or Circle's frame never loaded.
    if (err.status === 0 || err.status === 404 || (err.status !== null && err.status >= 500) || err.code === CIRCLE_CODE.networkError) return EMAIL_UNAVAILABLE
  }
  return explainError(err)
}

type Stage = 'idle' | 'code' | 'opening'

// Continue with email: an email address and a Turnstile check, then Circle's code screen, then the account opens.
// A new person also approves Circle's create step once. onDone gets the account; the caller saves it.
export function EmailLogin({ onDone }: { onDone: (session: EmailSession) => void }) {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)
  const address = email.trim()
  const emailError = !tried ? undefined : address === '' ? 'Enter your email address.' : EMAIL_PATTERN.test(address) ? undefined : 'Enter a full email address, like name@example.com.'

  useEffect(() => {
    let live = true
    // Circle's SDK takes a few seconds to load the first time, so it starts while the person types.
    loadCircleSdk().catch(() => {
      // Tried again on Send code, which shows the error.
    })
    loadTurnstile().then(
      (turnstile) => {
        if (!live || !box.current) return
        const id = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t) => {
            setToken(t)
            setError((e) => (e === TURNSTILE_FAILED || e === CHECK_PENDING ? null : e))
          },
          'error-callback': () => {
            setToken(null)
            setError(TURNSTILE_FAILED)
          },
          'expired-callback': () => setToken(null),
        })
        if (id) widget.current = { turnstile, id }
      },
      () => {
        if (live) setError(EMAIL_UNAVAILABLE)
      },
    )
    return () => {
      live = false
      if (widget.current) widget.current.turnstile.remove(widget.current.id)
      widget.current = null
    }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (stage !== 'idle' || !EMAIL_PATTERN.test(address)) return
    if (!token) {
      setError(CHECK_PENDING)
      return
    }
    setError(null)
    setStage('code')
    try {
      await sendEmailCode(address, token, (err) => setError(emailErrorText(err)))
      setError(null)
      setStage('opening')
      onDone(await openEmailAccount(address))
    } catch (err) {
      if (err instanceof EmailLoginStopped) setError(err.newCode ? NEW_CODE : null)
      else setError(emailErrorText(err))
      // A Turnstile token works once. The next Send code gets a fresh check.
      setToken(null)
      if (widget.current) widget.current.turnstile.reset(widget.current.id)
      setStage('idle')
    }
  }

  const busy = stage !== 'idle'
  return (
    <form className="email-form" onSubmit={submit} noValidate>
      <div className="email-field">
        <Field id="email-address" label="Email address" error={emailError}>
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </Field>
      </div>
      <div ref={box} className="email-turnstile" />
      <Button type="submit" size="lg" block disabled={busy}>
        Send code
      </Button>
      <p className="email-note">We email you a code. Enter it in the Circle window that opens. New to Fundit? The same code creates your account.</p>
      {stage === 'code' && <p className="email-hint">Enter the code from your email in the Circle window.</p>}
      {stage === 'opening' && <p className="email-hint">Opening your account. A new account asks you to approve one step in the Circle window.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
