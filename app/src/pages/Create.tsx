import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router'
import { type Address, decodeEventLog, encodeFunctionData, type Hex, isAddressEqual, type TransactionReceipt } from 'viem'
import { factoryAbi } from '../abi/factory'
import { SignInButton } from '../components/AccountMenu'
import { CampaignImage } from '../components/CampaignImage'
import { SharePanel } from '../components/SharePanel'
import { AddMoneyLink, PASSKEY_PROCESSING, recheckResult } from '../components/TxStatus'
import { EXPLORER_URL, FACTORY_ADDRESS, type TokenSymbol } from '../config'
import { useFactoryFees } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { explainError, needsAddMoney } from '../lib/errors'
import { bpsToPercent } from '../lib/format'
import type { Sender, TxResult } from '../lib/sender'
import { byteLength, MAX_DESCRIPTION, MAX_LINKS, MAX_TITLE, validateCampaign } from '../lib/validate'


type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking'; hash: Hex }
  // userop marks a passkey user operation hash: no explorer link, and only the passkey bundler can check it.
  // note explains a re-check that failed to answer. The outcome is still unknown.
  | { kind: 'timeout'; hash: Hex; userop?: boolean; note?: string }
  // addMoney: the account is short of USDC for the network fee, so the box links to Add money.
  | { kind: 'error'; message: string; hash?: Hex; addMoney?: boolean }
  // The new Fundit exists. The page shows its link and share options.
  | { kind: 'created'; address: Address; title: string }

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
  // Set synchronously, so a second click before React re-renders cannot start a second send or check.
  const inFlight = useRef(false)
  // The sender of the last send, so a re-check of its timeout goes the same way.
  const lastSender = useRef<Sender | null>(null)

  const result = validateCampaign({ title, description, imageUrl, links, goal, token, backup, sender: sender?.address })
  const errors = result.ok ? {} : result.errors
  // A field shows its error once the person has typed in it or left it.
  const shown = (key: string, touchKey = key) => (touched[touchKey] ? errors[key] : undefined)
  const touch = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))

  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  // An unconfirmed create may still be mined. Until a check settles it or the person starts over, no second one.
  const canSubmit = result.ok && sender !== null && fees.data !== undefined && !busy && phase.kind !== 'timeout'

  function handle(res: TxResult) {
    switch (res.status) {
      case 'success': {
        const campaign = createdCampaign(res.receipt)
        if (!campaign) {
          setPhase({
            kind: 'error',
            message: 'The Fundit was created, but we could not read its address. You can find it on My page.',
            hash: res.hash,
          })
          return
        }
        void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
        setPhase({ kind: 'created', address: campaign, title: title.trim() })
        return
      }
      case 'reverted':
        setPhase({ kind: 'error', message: res.error, hash: res.hash })
        return
      case 'timeout':
        setPhase({ kind: 'timeout', hash: res.hash, userop: res.hashKind === 'userop' })
        return
      case 'rejected':
        setPhase({ kind: 'error', message: 'You cancelled the request.' })
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current || !canSubmit || !result.ok || !sender) return
    inFlight.current = true
    setPhase({ kind: 'sending' })
    lastSender.current = sender
    try {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: 'createCampaign',
        args: [result.token, result.goal, result.backup, result.meta],
      })
      handle(await sender.send([{ to: FACTORY_ADDRESS, data }], { label: 'Create fundraiser' }))
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err), addMoney: needsAddMoney(err) })
    } finally {
      inFlight.current = false
    }
  }

  // Checks the same transaction again. It never sends a new one, which could create the fundraiser twice.
  async function checkAgain(hash: Hex, userop: boolean) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking', hash })
    try {
      handle(await recheckResult(lastSender.current ?? sender, hash, userop))
    } catch (err) {
      // The check itself failed, so the transaction is still unknown. Never leave the page on "Checking...".
      setPhase({ kind: 'timeout', hash, userop, note: `We could not check it. ${explainError(err)}` })
    } finally {
      inFlight.current = false
    }
  }

  function startOver() {
    const ok = window.confirm(
      'The earlier transaction may still go through. If it does and you create again, you will have two Fundits. Start over anyway?',
    )
    if (ok) setPhase({ kind: 'idle' })
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

  if (phase.kind === 'created') {
    return (
      <section className="create-done">
        <header className="page-head">
          <h1>Your Fundit is live</h1>
          <p className="muted">Share it now, so the first gifts can come in.</p>
          <Link to={`/c/${phase.address}`} className="btn btn-lg">
            Go to your Fundit
          </Link>
        </header>
        <section className="panel" aria-labelledby="share-heading">
          <SharePanel address={phase.address} title={phase.title} isCreator headingId="share-heading" />
        </section>
      </section>
    )
  }

  // Signed out, the page asks to sign in and stays here, so the form shows once a wallet is connected. A
  // transaction already in flight keeps the form and its status on screen even if the wallet goes away.
  if (!sender && phase.kind === 'idle') {
    return (
      <section className="notice">
        <h1>Sign in to start a Fundit</h1>
        <p>Sign in first. Then you can tell your story and set your goal.</p>
        <SignInButton className="btn btn-lg" />
      </section>
    )
  }

  return (
    <section className="create">
      <header className="page-head">
        <h1>Start a Fundit</h1>
        <p className="muted">The money people give is held for your Fundit, and only you can withdraw it.</p>
      </header>

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
            If you lose this wallet, the backup address can ask to take over the Fundit. It becomes the organiser after
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
              <li>These rates are fixed for this Fundit when you create it.</li>
              <li>Creating the Fundit costs a small network fee, paid in USDC.</li>
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
                again, so you do not create the Fundit twice.
              </p>
              <p>{phase.userop ? PASSKEY_PROCESSING : <ExplorerLink hash={phase.hash} />}</p>
              {phase.note && <p className="field-error">{phase.note}</p>}
              <div className="donate-actions">
                <button type="button" className="btn btn-outline" onClick={() => checkAgain(phase.hash, phase.userop === true)}>
                  Check again
                </button>
                <button type="button" className="btn btn-outline" onClick={startOver}>
                  Start over
                </button>
              </div>
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="status-box status-error">
              <p>
                {phase.message}
                {phase.addMoney && (
                  <>
                    {' '}
                    <AddMoneyLink />
                  </>
                )}
              </p>
              {phase.hash && (
                <p>
                  <ExplorerLink hash={phase.hash} />
                </p>
              )}
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-lg create-submit" disabled={!canSubmit}>
          {busy ? 'Creating...' : 'Create a Fundit'}
        </button>
      </form>
    </section>
  )
}
