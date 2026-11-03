import { useState } from 'react'
import { Link } from 'react-router'
import { Actions, Button, Dialog } from './ui'
import './GiveNotice.css'

// The full donor notice. The text is the signed-off wording from the fraud and trust design, word for word.
export function GiveNotice({ review, onCancel, onContinue }: { review: boolean; onCancel: () => void; onContinue: () => void }) {
  const [understood, setUnderstood] = useState(false)
  return (
    <Dialog open labelledBy="give-notice-title" onClose={onCancel}>
      <h2 id="give-notice-title" className="ui-dialog-title">
        Before you give
      </h2>
      {review && <p className="give-notice-review">This Fundit is under review after a report. Think carefully before you give.</p>}
      <ul className="give-notice-list">
        <li>Gifts can't be reversed. Once your gift is on the blockchain, it is final.</li>
        <li>There are no refunds. The money goes to the Fundit, and only its organiser decides how to use it. Fundit can't return a gift.</li>
        <li>
          Fundit doesn't check every Fundit or organiser. We act on reports and may hide a Fundit or mark it under review, but we can't control or
          guarantee how an organiser uses the money, and we aren't responsible for what they do with it.
        </li>
        <li>Only give to people and causes you trust.</li>
      </ul>
      <p>
        Read the{' '}
        <Link to="/terms" target="_blank">
          Terms
        </Link>{' '}
        (sections 6 and 10).
      </p>
      <label className="give-notice-check">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>I understand</span>
      </label>
      <Actions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!understood} onClick={onContinue}>
          Continue
        </Button>
      </Actions>
    </Dialog>
  )
}
