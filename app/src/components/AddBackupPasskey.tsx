import { useId, useState } from 'react'
import { explainError } from '../lib/errors'
import { addBackupPasskey, markBackupSaved, newRecoveryPhrase, type StoredPasskey } from '../lib/passkey'

type Props = {
  stored: StoredPasskey
  // Shown as a Later button. My page leaves it out, so it keeps asking until a backup is saved.
  onLater?: () => void
  onDone?: () => void
  headingId?: string
}

// Asks a passkey account to add a recovery key. The words are shown once, after Circle has registered them,
// and the backup only counts as saved when the person says they wrote the words down.
export function AddBackupPasskey({ stored, onLater, onDone, headingId }: Props) {
  const ownId = useId()
  const id = headingId ?? ownId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phrase, setPhrase] = useState<string | null>(null)

  async function add() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const words = await newRecoveryPhrase()
      await addBackupPasskey(stored, words)
      setPhrase(words)
    } catch (err) {
      setError(explainError(err))
    } finally {
      setBusy(false)
    }
  }

  function saved() {
    markBackupSaved(stored.address)
    onDone?.()
  }

  return (
    <section className="backup-prompt" aria-labelledby={id}>
      <h2 id={id}>Add a backup</h2>
      <p>If you lose every device with your passkey, nobody can recover your Fundit account. Add a second device or a recovery key now.</p>
      {phrase === null ? (
        <div className="backup-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void add()}>
            Add a backup
          </button>
          {onLater && (
            <button type="button" className="btn btn-outline" disabled={busy} onClick={onLater}>
              Later
            </button>
          )}
        </div>
      ) : (
        <>
          <p>
            Your recovery key is these 12 words. Write them down in this order and keep them somewhere safe. Anyone who has these words can take
            your account, so never share them. Fundit cannot show them again.
          </p>
          <ol className="recovery-phrase">
            {phrase.split(' ').map((word, i) => (
              <li key={i}>{word}</li>
            ))}
          </ol>
          <button type="button" className="btn" onClick={saved}>
            I saved my recovery key
          </button>
        </>
      )}
      {busy && <p className="hint">Follow the steps your browser shows.</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
