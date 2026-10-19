import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'
import { type Address, decodeEventLog, encodeFunctionData, type Hex, isAddressEqual, type TransactionReceipt } from 'viem'
import { factoryAbi } from '../abi/factory'
import { SignInButton } from '../components/AccountMenu'
import { CampaignImage } from '../components/CampaignImage'
import { SharePanel } from '../components/SharePanel'
import { AddMoneyLink, PASSKEY_PROCESSING, recheckResult } from '../components/TxStatus'
import { AmountInput, Button, ButtonLink, Card, Field, PageHeader, StatusBox } from '../components/ui'
import { EXPLORER_URL, FACTORY_ADDRESS, type TokenSymbol } from '../config'
import { useFactoryFees } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { explainError, needsAddMoney } from '../lib/errors'
import { bpsToPercent } from '../lib/format'
import type { Sender, TxResult } from '../lib/sender'
import { byteLength, MAX_DESCRIPTION, MAX_LINKS, MAX_TITLE, validateCampaign } from '../lib/validate'
import '../components/Form.css'
import './Create.css'

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

function Counter({ used, max }: { used: number; max: number }) {
  return (
    <span className={used > max ? 'form-counter form-counter-over' : 'form-counter'}>
      {used} of {max} bytes
    </span>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="form-error" role="alert">
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
      <div className="create create-done">
        <PageHeader
          width="narrow"
          title="Your Fundit is live"
          subtitle="Share it now, so the first gifts can come in."
          actions={
            <ButtonLink to={`/c/${phase.address}`} size="lg">
              Go to your Fundit
            </ButtonLink>
          }
        />
        <Card label="Share this Fundit">
          <SharePanel address={phase.address} title={phase.title} isCreator headingId="share-heading" />
        </Card>
      </div>
    )
  }

  // Signed out, the page asks to sign in and stays here, so the form shows once a wallet is connected. A
  // transaction already in flight keeps the form and its status on screen even if the wallet goes away.
  if (!sender && phase.kind === 'idle') {
    return (
      <div className="create">
        <PageHeader
          width="narrow"
          title="Sign in to start a Fundit"
          subtitle="Sign in first. Then you can tell your story and set your goal."
          actions={<SignInButton className="ui-btn ui-btn-primary ui-btn-lg" />}
        />
      </div>
    )
  }

  return (
    <div className="create">
      <PageHeader width="narrow" title="Start a Fundit" subtitle="The money people give is held for your Fundit, and only you can withdraw it." />

      <form className="form create-form" onSubmit={submit} noValidate>
        <Card>
          <div className="form-fields">
            <Field label="Title" id="title" hint={<Counter used={byteLength(title.trim())} max={MAX_TITLE} />} error={shown('title')} alert>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  touch('title')
                }}
                onBlur={() => touch('title')}
              />
            </Field>

            <Field
              label="Description"
              id="description"
              hint={
                <>
                  <Counter used={byteLength(description)} max={MAX_DESCRIPTION} />
                  <span className="create-hint-line">Emoji and letters with accents use more than one byte each.</span>
                </>
              }
              error={shown('description')}
              alert
            >
              <textarea
                rows={8}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  touch('description')
                }}
              />
            </Field>

            <div className="form-group">
              <Field label="Image link (optional)" id="image" error={shown('imageUrl')} alert>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value)
                    touch('imageUrl')
                  }}
                />
              </Field>
              {imageUrl.trim() !== '' && !errors.imageUrl && (
                <div className="create-preview">
                  <span className="form-hint">Preview</span>
                  <CampaignImage url={imageUrl.trim()} title={title} />
                </div>
              )}
            </div>

            <fieldset className="form-group">
              <legend className="form-legend">Links (optional)</legend>
              <p className="form-hint">Up to {MAX_LINKS} links, for example a website or social page. Each must start with https://</p>
              <div className="form-links">
                {links.map((link, i) => (
                  <div className="form-link" key={i}>
                    <div className="form-row">
                      <input
                        className="ui-input"
                        type="url"
                        inputMode="url"
                        placeholder="https://"
                        aria-label={`Link ${i + 1}`}
                        value={link}
                        onChange={(e) => setLink(i, e.target.value)}
                        aria-invalid={shown(`link-${i}`) ? true : undefined}
                        aria-describedby={`link-${i}-error`}
                      />
                      <Button variant="secondary" aria-label={`Remove link ${i + 1}`} onClick={() => removeLink(i)}>
                        Remove
                      </Button>
                    </div>
                    <FieldError id={`link-${i}-error`} message={shown(`link-${i}`)} />
                  </div>
                ))}
              </div>
              {links.length < MAX_LINKS && (
                <Button variant="secondary" className="create-add-link" onClick={() => setLinks((rows) => [...rows, ''])}>
                  Add a link
                </Button>
              )}
            </fieldset>

            <div className="create-row">
              <Field label="Goal" id="goal" error={shown('goal')} alert>
                <AmountInput
                  id="goal"
                  currency={token}
                  placeholder="1000"
                  value={goal}
                  onChange={(e) => {
                    setGoal(e.target.value)
                    touch('goal')
                  }}
                />
              </Field>

              <fieldset className="form-group">
                <legend className="form-legend">Currency</legend>
                <label className="form-choice">
                  <input type="radio" name="token" checked={token === 'USDC'} onChange={() => setToken('USDC')} />
                  <span className="form-choice-text">USDC</span>
                </label>
                <label className="form-choice">
                  <input type="radio" name="token" checked={token === 'EURC'} onChange={() => setToken('EURC')} />
                  <span className="form-choice-text">
                    EURC <span className="form-hint">Arc only: donations and payouts on Arc</span>
                  </span>
                </label>
              </fieldset>
            </div>

            <Field
              label="Backup address (optional)"
              id="backup"
              hint="If you lose your Fundit account, the backup address can ask to take over the Fundit. It becomes the organiser after a 7-day wait, and you can cancel from your Fundit account during those 7 days. Use a wallet you control that is not your Fundit account. Leave it empty for no backup."
              error={shown('backup')}
              alert
            >
              <input
                autoComplete="off"
                spellCheck={false}
                placeholder="0x..."
                value={backup}
                onChange={(e) => {
                  setBackup(e.target.value)
                  touch('backup')
                }}
              />
            </Field>
          </div>
        </Card>

        <Card tone="muted" className="create-fees" label="Fees">
          <h2 className="create-fees-title">Fees</h2>
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
            <div className="form-actions">
              <p className="form-error">Could not load the fees.</p>
              <Button variant="secondary" onClick={() => fees.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="form-hint">Loading fees...</p>
          )}
        </Card>

        {/* create-status and status-error stay: the e2e suite finds a failed create by them. */}
        <div className="create-status form-status" aria-live="polite">
          {phase.kind === 'sending' && <p>Confirm with your passkey, then wait for the network. This can take a few seconds.</p>}
          {phase.kind === 'checking' && <p>Checking the transaction again...</p>}
          {phase.kind === 'timeout' && (
            <StatusBox>
              <p>
                <strong>Your transaction is not confirmed yet.</strong> It may still go through. Check it before you try
                again, so you do not create the Fundit twice.
              </p>
              <p>{phase.userop ? PASSKEY_PROCESSING : <ExplorerLink hash={phase.hash} />}</p>
              {phase.note && <p className="form-error">{phase.note}</p>}
              <div className="form-actions">
                <Button variant="secondary" onClick={() => checkAgain(phase.hash, phase.userop === true)}>
                  Check again
                </Button>
                <Button variant="secondary" onClick={startOver}>
                  Start over
                </Button>
              </div>
            </StatusBox>
          )}
          {phase.kind === 'error' && (
            <StatusBox tone="error" className="status-error">
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
            </StatusBox>
          )}
        </div>

        <Button type="submit" size="lg" block disabled={!canSubmit}>
          {busy ? 'Creating...' : 'Create a Fundit'}
        </Button>
      </form>
    </div>
  )
}
