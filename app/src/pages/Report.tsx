import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { Banner, Button, Field, PageHeader } from '../components/ui'
import { TURNSTILE_SITE_KEY } from '../config'
import { loadTurnstile, type Turnstile } from '../lib/turnstile'
import '../components/Form.css'
import './Report.css'

// Same list as the Worker's REPORT_CATEGORIES (worker/report.ts).
const CATEGORIES = ['Signing in', 'Adding money', 'Giving', 'Creating or managing a Fundit', 'Withdrawing', 'Something else'] as const
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}$/

const HELP = "Don't include a sign-in code, private key or recovery phrase. Fundit will never ask for them."
const SENT = "Thanks. We read every report. If you left an email, we'll reply there."
const NOT_A_BOT = "We couldn't confirm you're not a bot. Try again."
const FAILED = "We couldn't send your report. Email hello@fundit.fun instead."

// The page the person was on: the footer link's router state, else the error screen's from query. Only a path
// on this site, at most 200 characters. Never "/report" itself.
function cameFrom(state: unknown, query: string | null): string {
  const fromState = typeof state === 'object' && state !== null ? (state as { from?: unknown }).from : undefined
  for (const v of [fromState, query]) {
    if (typeof v === 'string' && v.startsWith('/') && v.length <= 200 && !v.startsWith('//') && v !== '/report') return v
  }
  return ''
}

type Stage = 'idle' | 'sending' | 'sent'

// The public "Report a problem" form. The Worker (worker/report.ts) sends it to the team's private Telegram chat.
export function Report() {
  const location = useLocation()
  const [search] = useSearchParams()
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [page, setPage] = useState(() => cameFrom(location.state, search.get('from')))
  const [what, setWhat] = useState('')
  const [tx, setTx] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let live = true
    loadTurnstile().then(
      (turnstile) => {
        if (!live || !box.current) return
        const id = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: setToken,
          'error-callback': () => {
            setToken(null)
            setError(NOT_A_BOT)
          },
          'expired-callback': () => setToken(null),
        })
        if (id) widget.current = { turnstile, id }
      },
      () => {
        if (live) setError(FAILED)
      },
    )
    return () => {
      live = false
      if (widget.current) widget.current.turnstile.remove(widget.current.id)
      widget.current = null
    }
  }, [])

  if (!TURNSTILE_SITE_KEY) {
    return (
      <section className="report">
        <PageHeader title="Report a problem" width="narrow" />
        <Banner tone="attention">{FAILED}</Banner>
      </section>
    )
  }

  const whatError = tried && what.trim() === '' ? 'Tell us what happened.' : undefined
  const emailError = tried && email.trim() !== '' && !EMAIL_PATTERN.test(email.trim()) ? 'Enter a full email address, like name@example.com.' : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (stage !== 'idle' || what.trim() === '' || (email.trim() !== '' && !EMAIL_PATTERN.test(email.trim()))) return
    if (!token) {
      setError('Wait a moment for the browser check to finish, then try again.')
      return
    }
    setError(null)
    setStage('sending')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          page: page.trim().slice(0, 200),
          what: what.trim(),
          ...(tx.trim() && { tx: tx.trim() }),
          ...(email.trim() && { email: email.trim() }),
          turnstile: token,
        }),
      })
      if (res.ok) {
        setStage('sent')
        return
      }
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      setError(res.status === 403 && body?.error === 'turnstile' ? NOT_A_BOT : FAILED)
    } catch {
      setError(FAILED)
    }
    // A Turnstile token works once. The next send gets a fresh check.
    setToken(null)
    if (widget.current) widget.current.turnstile.reset(widget.current.id)
    setStage('idle')
  }

  if (stage === 'sent') {
    return (
      <section className="report">
        <PageHeader title="Report a problem" width="narrow" />
        <Banner>{SENT}</Banner>
      </section>
    )
  }

  const busy = stage === 'sending'
  return (
    <section className="report">
      <PageHeader title="Report a problem" subtitle={HELP} width="narrow" />
      <form className="form" onSubmit={submit} noValidate>
        <Field id="report-category" label="What is it about?">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field id="report-page" label="Page">
          <input type="text" maxLength={200} value={page} onChange={(e) => setPage(e.target.value)} disabled={busy} />
        </Field>
        <Field id="report-what" label="What happened" error={whatError} alert>
          <textarea rows={6} maxLength={2000} value={what} onChange={(e) => setWhat(e.target.value)} disabled={busy} />
        </Field>
        <Field id="report-tx" label="Transaction link or hash (optional)">
          <input type="text" maxLength={200} autoComplete="off" value={tx} onChange={(e) => setTx(e.target.value)} disabled={busy} />
        </Field>
        <Field id="report-email" label="Email (optional)" hint="Only if you want a reply." error={emailError} alert>
          <input type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </Field>
        <div ref={box} className="report-turnstile" />
        <Button type="submit" size="lg" block disabled={busy}>
          Send report
        </Button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
