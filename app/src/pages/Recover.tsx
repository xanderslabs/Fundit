import { type ClipboardEvent, type FormEvent, useRef, useState } from 'react'
import type { Address } from 'viem'
import { AddressQr, CopyAddress } from '../components/AddressTools'
import { AddBackupPasskey } from '../components/AddBackupPasskey'
import { usernameError } from '../components/PasskeyLogin'
import { explainError } from '../lib/errors'
import { checkPendingRecovery, discardPendingRecovery, normalizePhrase, RecoveryNeedsFunds, recoverWithPhrase, type StoredPasskey } from '../lib/passkey'

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

  // A pasted phrase fills this field and the ones after it.
  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizePhrase(e.clipboardData.getData('text'))
    if (!pasted.includes(' ')) return
    e.preventDefault()
    const parts = pasted.split(' ')
    setWords((w) => w.map((old, j) => (j >= i && j - i < parts.length ? parts[j - i]! : old)))
  }

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
      <section className="manage">
        <header className="page-head">
          <h1>Your account is back.</h1>
          <p className="muted">
            This device has a new passkey for your Fundit account. Add a new recovery key now. Your old one still works, so keep it safe or
            destroy it.
          </p>
        </header>
        <div className="panel manage-section">
          <AddBackupPasskey stored={recovered} />
        </div>
      </section>
    )
  }

  return (
    <section className="manage">
      <header className="page-head">
        <h1>Recover your Fundit account</h1>
        <p className="muted">Enter the 12 words of your recovery key. We'll make a new passkey on this device and move your account to it.</p>
      </header>

      <div className="panel manage-section">
        {pending ? (
          <>
            <p>Your recovery is still confirming. Check again in a minute.</p>
            {stuck && <p>This is taking longer than usual. You can start over with your recovery key.</p>}
            <div className="backup-actions">
              <button type="button" className="btn" disabled={busy} onClick={check}>
                Check again
              </button>
              {stuck && (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={startOver}>
                  Start over
                </button>
              )}
            </div>
          </>
        ) : (
          <form className="backup-confirm" onSubmit={submit} noValidate>
            <fieldset className="recover-words" disabled={busy}>
              <legend>Your recovery key</legend>
              {words.map((w, i) => (
                <div className="form-field" key={i}>
                  <label htmlFor={`recover-word-${i + 1}`}>Word {i + 1}</label>
                  <input
                    id={`recover-word-${i + 1}`}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={w}
                    onChange={(e) => setWords((all) => all.map((old, j) => (j === i ? e.target.value : old)))}
                    onPaste={(e) => onPaste(i, e)}
                  />
                </div>
              ))}
            </fieldset>
            <div className="form-field">
              <label htmlFor="recover-username">Name for your new passkey</label>
              <input
                id="recover-username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError && <p className="field-error">{nameError}</p>}
            </div>
            {needsFunds && (
              <div className="recover-fund">
                <p>{needsFunds.message}</p>
                <CopyAddress address={needsFunds.account} />
                <AddressQr address={needsFunds.account} label="QR code of your account address" />
              </div>
            )}
            <button type="submit" className="btn" disabled={busy}>
              Recover my account
            </button>
          </form>
        )}
        {busy && <p className="hint">Follow the steps your browser shows.</p>}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
