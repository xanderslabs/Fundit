import { type ClipboardEvent, type FormEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Address } from 'viem'
import { SignInButton } from '../components/AccountMenu'
import { AddressQr } from '../components/AddressTools'
import { AddBackupPasskey } from '../components/AddBackupPasskey'
import { usernameError } from '../components/PasskeyLogin'
import { AddressChip, Button, Card, Field, PageHeader, StatusBox } from '../components/ui'
import { explainError } from '../lib/errors'
import {
  checkPendingRecovery,
  discardPendingRecovery,
  normalizePhrase,
  RecoveryNeedsFunds,
  recoverWithPhrase,
  type StoredPasskey,
  usePasskeySession,
} from '../lib/passkey'
import './Recover.css'

const WORDS = 12
const INVALID = "Those words don't form a valid recovery key. Check the order and spelling."
const empty = () => Array<string>(WORDS).fill('')
const START_OVER = 'If your recovery already went through, starting over is safe: we will find it.'

// Recover a passkey account with its 12-word recovery key. The words live only in this component's state:
// they are never stored, logged or put in the URL, and lib/passkey sends only derived addresses and signatures.
export function Recover() {
  const [words, setWords] = useState<string[]>(empty)
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsFunds, setNeedsFunds] = useState<RecoveryNeedsFunds | null>(null)
  const [pending, setPending] = useState<Address | null>(null)
  // Check again found no receipt after the cutoff: the recovery was probably dropped.
  const [stuck, setStuck] = useState(false)
  const [recovered, setRecovered] = useState<StoredPasskey | null>(null)
  // A second click while the first recovery runs must not start another one.
  const inFlight = useRef(false)

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      if (err instanceof RecoveryNeedsFunds) setNeedsFunds(err)
      else setError(explainError(err))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function settle(res: Awaited<ReturnType<typeof checkPendingRecovery>>) {
    setStuck(res.status === 'stuck')
    if (res.status === 'recovered') {
      setWords(empty())
      setPending(null)
      setNeedsFunds(null)
      setRecovered(res.session)
    } else if (res.status === 'pending' || res.status === 'stuck') {
      // Check again needs only the account, so the words go now. A later revert means typing them again.
      setWords(empty())
      setPending(res.account)
    } else {
      // The record is gone (it reverted or expired). The person can try again with the words.
      setPending(null)
    }
  }

  // A pasted full phrase fills all 12 fields from the first, whichever field it lands in. A shorter paste fills
  // this field and the ones after it.
  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizePhrase(e.clipboardData.getData('text'))
    if (!pasted.includes(' ')) return
    e.preventDefault()
    const parts = pasted.split(' ')
    const from = parts.length >= WORDS ? 0 : i
    setWords((w) => w.map((old, j) => (j >= from && j - from < parts.length ? parts[j - from]! : old)))
  }

  const navigate = useNavigate()
  const session = usePasskeySession()
  const name = username.trim()
  const [submitted, setSubmitted] = useState(false)
  const nameError = usernameError(name, submitted)

  function submit(e: FormEvent) {
    e.preventDefault()
    const phrase = normalizePhrase(words.join(' '))
    if (phrase.split(' ').length !== WORDS) {
      setError(INVALID)
      return
    }
    if (name === '') {
      setError('Enter a name for your new passkey.')
      return
    }
    setSubmitted(true)
    if (usernameError(name, true)) return
    void run(async () => {
      setNeedsFunds(null)
      settle(await recoverWithPhrase({ phrase, username: name }))
    })
  }

  // A revert clears the lib's record and throws. The form comes back with the error.
  const check = () =>
    void run(async () => {
      try {
        settle(await checkPendingRecovery(pending!))
      } catch (err) {
        setPending(null)
        throw err
      }
    })

  // Forgets only the pending record. If that recovery went through, the next one finds its passkey on chain.
  function startOver() {
    if (!pending || !window.confirm(START_OVER)) return
    discardPendingRecovery(pending)
    setPending(null)
    setStuck(false)
    setError(null)
  }

  if (recovered) {
    return (
      <section className="recover">
        <PageHeader
          width="narrow"
          title="Your account is back."
          subtitle={
            <p>
              This device has a new passkey for your Fundit account. Add a new recovery key now. Your old one still works, so keep it safe or
              destroy it.
            </p>
          }
        />
        <Card>
          <AddBackupPasskey stored={recovered} />
        </Card>
      </section>
    )
  }

  return (
    <section className="recover">
      <PageHeader
        width="narrow"
        title="Recover your Fundit account"
        subtitle={<p>Enter the 12 words of your recovery key. We'll make a new passkey on this device and move your account to it.</p>}
      />

      <Card className="recover-card">
        {pending ? (
          <>
            <p>Your recovery is still confirming. Check again in a minute.</p>
            {stuck && <p>This is taking longer than usual. You can start over with your recovery key.</p>}
            <div className="backup-actions">
              <Button disabled={busy} onClick={check}>
                Check again
              </Button>
              {stuck && (
                <Button variant="secondary" disabled={busy} onClick={startOver}>
                  Start over
                </Button>
              )}
            </div>
          </>
        ) : (
          <form className="recover-form" onSubmit={submit} noValidate>
            <fieldset className="recover-words" disabled={busy}>
              <legend>Your recovery key</legend>
              {words.map((w, i) => (
                // The visible label is the number. The input's own name says "Word 1" to screen readers.
                <Field key={i} id={`recover-word-${i + 1}`} label={`${i + 1}`}>
                  <input
                    aria-label={`Word ${i + 1}`}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={w}
                    onChange={(e) => setWords((all) => all.map((old, j) => (j === i ? e.target.value : old)))}
                    onPaste={(e) => onPaste(i, e)}
                  />
                </Field>
              ))}
            </fieldset>
            <Field id="recover-username" label="Name for your new passkey" error={nameError ?? undefined}>
              <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
            </Field>
            {needsFunds && (
              <StatusBox>
                <p>{needsFunds.message}</p>
                <div className="recover-fund-body">
                  <AddressQr address={needsFunds.account} label="QR code of your account address" />
                  <AddressChip address={needsFunds.account} full />
                </div>
              </StatusBox>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              Recover my account
            </Button>
          </form>
        )}
        {busy && <p className="recover-hint">Follow the steps your browser shows.</p>}
        {error && (
          <p className="ui-field-error" role="alert">
            {error}
          </p>
        )}
      </Card>
      {!session && (
        <p className="recover-back">
          Still have your passkey? <SignInButton className="link-button" label="Back to sign in" onPasskeyDone={() => navigate('/me')} />
        </p>
      )}
    </section>
  )
}
