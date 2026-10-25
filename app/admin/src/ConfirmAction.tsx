import { useState } from 'react'
import { Actions, Button, Dialog } from '../../src/components/ui'

// The last step before the wallet asks to sign: what will be called, the value now and the value after.
// onConfirm handles its own errors, so the dialog only tracks that it is busy.
export function ConfirmAction({
  open,
  title,
  rows,
  note,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  rows: { label: string; value: string }[]
  note?: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} title={title}>
      <dl className="admin-stats">
        {rows.map((r) => (
          <div key={r.label} className="admin-row">
            <dt className="admin-row-label">{r.label}</dt>
            <dd className="admin-row-value admin-confirm-value">{r.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="admin-note">{note}</p>}
      <Actions>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button loading={busy} onClick={() => void confirm()}>
          Confirm and sign
        </Button>
      </Actions>
    </Dialog>
  )
}
