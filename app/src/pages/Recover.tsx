import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { AddBackupPasskey } from '../components/AddBackupPasskey'
import { explainError } from '../lib/errors'
import { checkPendingRecovery, normalizePhrase, RecoveryNeedsFunds, recoverWithPhrase, type StoredPasskey } from '../lib/passkey'
import { qrMatrix, qrPath } from '../lib/qr'

const WORDS = 12
const INVALID = "Those words don't form a valid recovery key. Check the order and spelling."
const MAX_USERNAME = 32
const empty = () => Array<string>(WORDS).fill('')

function AccountQr({ address }: { address: Address }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null)
  useEffect(() => {
    let live = true
    void qrMatrix(address).then((m) => live && setQr({ size: m.size + 8, path: qrPath(m) }))
    return () => {
      live = false
    }
  }, [address])
  if (!qr) return null
  return (
    <svg className="fund-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code of your account address">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#101928" />
    </svg>
  )
}

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="fund-address">
      <code>{address}</code>
      <button type="button" className="btn btn-outline" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy address'}
      </button>
      {copied === false && <p className="field-error">Could not copy. Select the address and copy it yourself.</p>}
    </div>
  )
}

// Recover a passkey account with its 12-word recovery key. The words live only in this component's state:
// they are never stored, logged or put in the URL, and lib/passkey sends only derived addresses and signatures.
export function Recover() {
  const [words, setWords] = useState<string[]>(empty)
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsFunds, setNeedsFunds] = useState<RecoveryNeedsFunds | null>(null)
  const [pending, setPending] = useState<Address | null>(null)
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
    if (res.status === 'recovered') {
      setWords(empty())
      setPending(null)
      setNeedsFunds(null)
      setRecovered(res.session)
    } else if (res.status === 'pending') {
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
  const nameError = name.length > MAX_USERNAME ? `Keep the name to ${MAX_USERNAME} characters.` : null

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
    if (nameError) return
    void run(async () => {
      setNeedsFunds(null)
      settle(await recoverWithPhrase({ phrase, username: name }))
    })
  }

  const check = () => void run(async () => settle(await checkPendingRecovery(pending!)))

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
            <div className="backup-actions">
              <button type="button" className="btn" disabled={busy} onClick={check}>
                Check again
              </button>
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
                <AccountQr address={needsFunds.account} />
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
