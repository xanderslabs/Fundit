import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { type Address, decodeEventLog, encodeFunctionData, type Hex, isAddressEqual, type TransactionReceipt } from 'viem'
import { arc } from 'viem/chains'
import { factoryAbi } from '../abi/factory'
import { CampaignImage } from '../components/CampaignImage'
import { FACTORY_ADDRESS, TX_TIMEOUT_MS, type TokenSymbol } from '../config'
import { useFactoryFees } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { explainError } from '../lib/errors'
import { bpsToPercent } from '../lib/format'
import { arcReceipts, type TxResult, waitForResult } from '../lib/sender'
import { byteLength, MAX_DESCRIPTION, MAX_LINKS, MAX_TITLE, validateCampaign } from '../lib/validate'

const EXPLORER_URL = arc.blockExplorers.default.url

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking'; hash: Hex }
  | { kind: 'timeout'; hash: Hex }
  | { kind: 'error'; message: string; hash?: Hex }

// The new campaign's address is only known from the factory's CampaignCreated log in the receipt.
function createdCampaign(receipt: TransactionReceipt): Address | null {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, FACTORY_ADDRESS)) continue
    try {
      const event = decodeEventLog({ abi: factoryAbi, topics: log.topics, data: log.data })
      if (event.eventName === 'CampaignCreated') return event.args.campaign
    } catch {
      // Another factory event. Keep looking.
    }
  }
  return null
}

function Counter({ id, used, max }: { id: string; used: number; max: number }) {
  return (
    <span id={id} className={used > max ? 'counter counter-over' : 'counter'}>
      {used} of {max} bytes
    </span>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  )
}

function ExplorerLink({ hash }: { hash: Hex }) {
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      View it on the Arc explorer
    </a>
  )
}

export function Create() {
  const sender = useSender()
  const fees = useFactoryFees()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [links, setLinks] = useState<string[]>([''])
  const [goal, setGoal] = useState('')
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [backup, setBackup] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const result = validateCampaign({ title, description, imageUrl, links, goal, token, backup, sender: sender?.address })
  const errors = result.ok ? {} : result.errors
  // A field shows its error once the person has typed in it or left it.
  const shown = (key: string, touchKey = key) => (touched[touchKey] ? errors[key] : undefined)
  const touch = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))

  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  const canSubmit = result.ok && sender !== null && fees.data !== undefined && !busy

  function handle(res: TxResult) {
    switch (res.status) {
      case 'success': {
        const campaign = createdCampaign(res.receipt)
        if (!campaign) {
          setPhase({
            kind: 'error',
            message: 'The fundraiser was created, but we could not read its address. You can find it on My page.',
            hash: res.hash,
          })
          return
        }
        void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
        navigate(`/c/${campaign}`)
        return
      }
      case 'reverted':
        setPhase({ kind: 'error', message: res.error, hash: res.hash })
        return
      case 'timeout':
        setPhase({ kind: 'timeout', hash: res.hash })
        return
      case 'rejected':
        setPhase({ kind: 'error', message: 'You cancelled the request.' })
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || !result.ok || !sender) return
    setPhase({ kind: 'sending' })
    try {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: 'createCampaign',
        args: [result.token, result.goal, result.backup, result.meta],
      })
      handle(await sender.send([{ to: FACTORY_ADDRESS, data }], { label: 'Create fundraiser' }))
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err) })
    }
  }

  // Checks the same transaction again. It never sends a new one, which could create the fundraiser twice.
  async function checkAgain(hash: Hex) {
    setPhase({ kind: 'checking', hash })
    handle(await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS))
  }

  function setLink(i: number, value: string) {
    setLinks((rows) => rows.map((r, j) => (j === i ? value : r)))
    touch(`link-${i}`)
  }

  function removeLink(i: number) {
    setLinks((rows) => (rows.length === 1 ? [''] : rows.filter((_, j) => j !== i)))
    // Row indexes shift, so start the remaining rows fresh.
    setTouched((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('link-'))))
  }

  return (
    <section className="create">
      <header className="page-head">
        <h1>Start a fundraiser</h1>
        <p className="muted">Donations go into an on-chain escrow on Arc. Only you can withdraw them.</p>
      </header>

      {!sender && <p className="create-connect">Connect your wallet to start a fundraiser. Use the button at the top of the page.</p>}

      <form className="create-form" onSubmit={submit} noValidate>
        <div className="form-field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              touch('title')
            }}
            onBlur={() => touch('title')}
            aria-invalid={shown('title') ? true : undefined}
            aria-describedby="title-count title-error"
          />
          <Counter id="title-count" used={byteLength(title.trim())} max={MAX_TITLE} />
          <FieldError id="title-error" message={shown('title')} />
        </div>

        <div className="form-field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={8}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              touch('description')
            }}
            aria-invalid={shown('description') ? true : undefined}
            aria-describedby="description-count description-error"
          />
          <Counter id="description-count" used={byteLength(description)} max={MAX_DESCRIPTION} />
          <p className="hint">Emoji and letters with accents use more than one byte each.</p>
          <FieldError id="description-error" message={shown('description')} />
        </div>

        <div className="form-field">
          <label htmlFor="image">Image link (optional)</label>
          <input
            id="image"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={imageUrl}
            onChange={(e) => {
              setImageUrl(e.target.value)
              touch('imageUrl')
            }}
            aria-invalid={shown('imageUrl') ? true : undefined}
            aria-describedby="image-error"
          />
          <FieldError id="image-error" message={shown('imageUrl')} />
          {imageUrl.trim() !== '' && !errors.imageUrl && (
            <div className="image-preview">
              <span className="hint">Preview</span>
              <CampaignImage url={imageUrl.trim()} title={title} />
            </div>
          )}
        </div>

        <fieldset className="form-field">
          <legend>Links (optional)</legend>
          <p className="hint">Up to {MAX_LINKS} links, for example a website or social page. Each must start with https://</p>
          {links.map((link, i) => (
            <div className="link-row" key={i}>
              <div className="link-input">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  aria-label={`Link ${i + 1}`}
                  value={link}
                  onChange={(e) => setLink(i, e.target.value)}
                  aria-invalid={shown(`link-${i}`) ? true : undefined}
                  aria-describedby={`link-${i}-error`}
                />
                <FieldError id={`link-${i}-error`} message={shown(`link-${i}`)} />
              </div>
              <button type="button" className="btn btn-outline" aria-label={`Remove link ${i + 1}`} onClick={() => removeLink(i)}>
                Remove
              </button>
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <button type="button" className="btn btn-outline" onClick={() => setLinks((rows) => [...rows, ''])}>
              Add a link
            </button>
          )}
        </fieldset>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="goal">Goal</label>
            <input
              id="goal"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1000"
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value)
                touch('goal')
              }}
              aria-invalid={shown('goal') ? true : undefined}
              aria-describedby="goal-error"
            />
            <FieldError id="goal-error" message={shown('goal')} />
          </div>

          <fieldset className="form-field">
            <legend>Currency</legend>
            <label className="choice">
              <input type="radio" name="token" checked={token === 'USDC'} onChange={() => setToken('USDC')} />
              <span>USDC</span>
            </label>
            <label className="choice">
              <input type="radio" name="token" checked={token === 'EURC'} onChange={() => setToken('EURC')} />
              <span>
                EURC <span className="hint">Arc only: donations and payouts on Arc</span>
              </span>
            </label>
          </fieldset>
        </div>

        <div className="form-field">
          <label htmlFor="backup">Backup address (optional)</label>
          <input
            id="backup"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x..."
            value={backup}
            onChange={(e) => {
              setBackup(e.target.value)
              touch('backup')
            }}
            aria-invalid={shown('backup') ? true : undefined}
            aria-describedby="backup-hint backup-error"
          />
          <p id="backup-hint" className="hint">
            If you lose this wallet, the backup address can ask to take over the fundraiser. It becomes the organiser after
            a 7-day wait, and you can cancel from this wallet during those 7 days. Use a wallet you control that is not
            this one. Leave it empty for no backup.
          </p>
          <FieldError id="backup-error" message={shown('backup')} />
        </div>

        <section className="panel create-fees" aria-label="Fees">
          <h2>Fees</h2>
          {fees.data ? (
            <ul>
              <li>
                {fees.data.donationFeeBps === 0
                  ? 'No fee on donations.'
                  : `Fundit keeps ${bpsToPercent(fees.data.donationFeeBps)} of each donation.`}
              </li>
              <li>Fundit keeps {bpsToPercent(fees.data.withdrawFeeBps)} of each withdrawal.</li>
              <li>These rates are fixed for this fundraiser when you create it.</li>
              <li>Creating the fundraiser costs a small network fee, paid in USDC.</li>
            </ul>
          ) : fees.isError ? (
            <p className="field-error">
              Could not load the fees.{' '}
              <button type="button" className="btn btn-outline" onClick={() => fees.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <p className="muted">Loading fees...</p>
          )}
        </section>

        <div className="create-status" aria-live="polite">
          {phase.kind === 'sending' && <p>Confirm in your wallet, then wait for the network. This can take a few seconds.</p>}
          {phase.kind === 'checking' && <p>Checking the transaction again...</p>}
          {phase.kind === 'timeout' && (
            <div className="status-box">
              <p>
                <strong>Your transaction is not confirmed yet.</strong> It may still go through. Check it before you try
                again, so you do not create the fundraiser twice.
              </p>
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
              <button type="button" className="btn btn-outline" onClick={() => checkAgain(phase.hash)}>
                Check again
              </button>
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="status-box status-error">
              <p>{phase.message}</p>
              {phase.hash && (
                <p>
                  <ExplorerLink hash={phase.hash} />
                </p>
              )}
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-lg create-submit" disabled={!canSubmit}>
          {busy ? 'Creating...' : 'Create fundraiser'}
        </button>
      </form>
    </section>
  )
}
