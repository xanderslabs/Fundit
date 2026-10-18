import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { explainError } from '../lib/errors'
import {
  addBackupPasskey,
  canPayBackupGas,
  checkPendingBackup,
  discardPendingBackup,
  newRecoveryPhrase,
  type StoredPasskey,
  useBackupPending,
} from '../lib/passkey'

type Props = {
  stored: StoredPasskey
  // Shown as a Later button. My page leaves it out, so it keeps asking until a backup is saved.
  onLater?: () => void
  onDone?: () => void
  headingId?: string
  // The question to ask before leaving, or null when leaving loses nothing. The dialog uses it for Escape,
  // the backdrop and Close.
  onGuardChange?: (message: string | null) => void
}

const LEAVE = 'Leave without saving your backup? Your recovery key has not been added yet.'
const KEEP_WORDS = 'Keep these words. The backup may still go through.'
const LEAVE_PENDING = `Leave without saving your backup? ${KEEP_WORDS}`
const START_OVER = 'Your last backup may still go through. If it does, the words you saved will also work. Start over with new words?'

// The leave question of the prompt on screen, if any. Sign out in the account menu asks it too.
let activeGuard: string | null = null

// True when leaving is fine: nothing to lose, or the person confirmed.
export function confirmLeave(): boolean {
  return activeGuard === null || window.confirm(activeGuard)
}

// Three different word numbers (1 to 12), in order, from the browser's secure random source.
function pickWords(): number[] {
  const picked = new Set<number>()
  const buf = new Uint32Array(1)
  while (picked.size < 3) {
    crypto.getRandomValues(buf)
    picked.add((buf[0]! % 12) + 1)
  }
  return [...picked].sort((a, b) => a - b)
}

// While leaving would lose the words, ask before the page unloads and before a link in the app is followed.
// The router here is a BrowserRouter, which has no navigation blocker, so link clicks are caught first.
function useLeaveGuard(message: string | null) {
  useEffect(() => {
    if (!message) return
    activeGuard = message
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    function onClick(e: MouseEvent) {
      const link = (e.target as Element | null)?.closest?.('a[href]')
      if (!link || link.closest('.backup-prompt')) return
      if (!confirmLeave()) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('click', onClick, true)
    return () => {
      activeGuard = null
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('click', onClick, true)
    }
  }, [message])
}

// Adds a recovery key to a passkey account. The words are made and shown first, the person types three of them
// back, and only then is the key's address sent to the account. The words live only in this component.
export function AddBackupPasskey({ stored, onLater, onDone, headingId, onGuardChange }: Props) {
  const ownId = useId()
  const id = headingId ?? ownId
  const pendingStored = useBackupPending(stored)
  const [funded, setFunded] = useState<boolean | null>(null)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [asked, setAsked] = useState<number[]>([])
  const [typed, setTyped] = useState<Record<number, string>>({})
  // sent: the operation went out but has not confirmed. sending: the send is in progress.
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  // Check again found no receipt after the cutoff: the operation was probably dropped.
  const [stuck, setStuck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    canPayBackupGas(stored.address).then(
      (ok) => live && setFunded(ok),
      // The send checks the balance again, so an unknown balance still lets the person try.
      () => live && setFunded(true),
    )
    return () => {
      live = false
    }
  }, [stored.address])

  // The Show button goes away when the words appear, so focus moves to their explanation.
  const wordsIntro = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (phrase !== null) wordsIntro.current?.focus()
  }, [phrase])

  const guard = phrase === null ? null : sent || sending ? LEAVE_PENDING : LEAVE
  useLeaveGuard(guard)
  useEffect(() => {
    onGuardChange?.(guard)
  }, [guard, onGuardChange])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  const show = () =>
    run(async () => {
      setPhrase(await newRecoveryPhrase())
      setAsked(pickWords())
    })

  function finish(status: string) {
    if (status === 'added') onDone?.()
  }

  const send = () =>
    run(async () => {
      const words = phrase!.split(' ')
      if (asked.some((n) => (typed[n] ?? '').trim().toLowerCase() !== words[n - 1])) {
        setError('Those words do not match. Check what you wrote down and try again.')
        return
      }
      setSending(true)
      try {
        const status = await addBackupPasskey(stored, phrase!)
        if (status === 'pending') setSent(true)
        finish(status)
      } finally {
        setSending(false)
      }
    })

  const check = () =>
    run(async () => {
      const status = await checkPendingBackup(stored)
      setStuck(status === 'stuck')
      finish(status)
    })

  // Forgets the unconfirmed backup and any words on screen, so a fresh backup can start.
  function startOver() {
    if (!window.confirm(START_OVER)) return
    discardPendingBackup(stored.address)
    setPhrase(null)
    setAsked([])
    setTyped({})
    setSent(false)
    setStuck(false)
    setError(null)
  }

  const pendingActions = (
    <div className="backup-actions">
      <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
        Check again
      </button>
      {stuck && (
        <button type="button" className="btn btn-outline" disabled={busy} onClick={startOver}>
          Start over
        </button>
      )}
    </div>
  )

  let body
  if (phrase !== null) {
    body = (
      <>
        <p ref={wordsIntro} tabIndex={-1}>
          Your recovery key is these 12 words. Write them down in this order and keep them somewhere safe. Anyone who has these words can control
          your account, so never share them. Fundit cannot show them again.
        </p>
        <ol className="recovery-phrase">
          {phrase.split(' ').map((word, i) => (
            <li key={i}>{word}</li>
          ))}
        </ol>
        {sent ? (
          <>
            <p>{KEEP_WORDS}</p>
            {pendingActions}
          </>
        ) : (
          <form
            className="backup-confirm"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <p>To check you wrote them down, type these words.</p>
            {asked.map((n) => (
              <div className="form-field" key={n}>
                <label htmlFor={`${id}-word-${n}`}>Word #{n}</label>
                <input
                  id={`${id}-word-${n}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={typed[n] ?? ''}
                  onChange={(e) => setTyped((t) => ({ ...t, [n]: e.target.value }))}
                  disabled={busy}
                />
              </div>
            ))}
            <button type="submit" className="btn" disabled={busy}>
              Add the recovery key
            </button>
          </form>
        )}
      </>
    )
  } else if (pendingStored) {
    body = (
      <>
        <p>Your last backup is still confirming.</p>
        {pendingActions}
      </>
    )
  } else if (funded === false) {
    body = (
      <p>
        Add a little money first. The backup costs a small network fee.{' '}
        <Link to="/add-money" onClick={onLater}>
          Add money
        </Link>
      </p>
    )
  } else {
    body = (
      <div className="backup-actions">
        <button type="button" className="btn" disabled={busy || funded === null} onClick={() => void show()}>
          Show my recovery key
        </button>
        {onLater && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onLater}>
            Later
          </button>
        )}
      </div>
    )
  }

  return (
    <section className="backup-prompt" aria-labelledby={id}>
      <h2 id={id}>Add a recovery key</h2>
      <p>
        If you lose every device with your passkey, nobody can recover your Fundit account. A recovery key is 12 words you write down and keep
        safe. Anyone with these words can control your account.
      </p>
      {body}
      {sending && <p className="hint">Follow the steps your browser shows.</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
