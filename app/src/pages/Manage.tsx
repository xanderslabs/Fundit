import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { type Address, encodeFunctionData, formatUnits, isAddress, isAddressEqual, zeroAddress } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { erc20Abi } from '../abi/erc20'
import { PendingBridgeTracker } from '../components/PendingBridgeTracker'
import { TxStatus, useTx } from '../components/TxStatus'
import { Actions, AddressChip, AmountInput, Button, EmptyState, Field, PageHeader, Panel, StatusBox } from '../components/ui'
import { ARC_DOMAIN, CHAIN_LABELS, TOKENS } from '../config'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { chainByKey, savePendingPayout } from '../lib/bridge'
import { BALANCES_KEY } from '../lib/deposit'
import type { CampaignView } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { PlainError } from '../lib/errors'
import { bpsToPercent, formatAmount, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { buildWithdrawCall, destDomain, netAfterWithdrawFee, type PayoutDest, payoutOptions } from '../lib/payout'
import type { Sender } from '../lib/sender'
import { ADDRESS_TYPO, byteLength, MAX_DESCRIPTION, MAX_LINKS, MAX_TITLE, parseTypedAddress, validateCampaign } from '../lib/validate'
import { NotFound } from './NotFound'
import { SignInRequired } from './SignInRequired'
import '../components/Form.css'
import './Manage.css'

const CLOSE_TEXT = 'Closing is permanent. Funds that arrive later can still be withdrawn.'
const CROSS_CHAIN_NOTE = 'Cross-chain payouts are new. Try a small amount first.'
const FEE_CHANGED = 'The transfer fee changed. Check the new amount and confirm again.'
const TOO_SMALL = 'This amount is too small to cover the transfer fee. Try a larger amount.'
const RETRY_WARNING = 'The earlier transaction may still go through. Try again anyway?'
const QUOTE_DEBOUNCE_MS = 400

function useRefresh(campaign: Address) {
  const queryClient = useQueryClient()
  return (balances = false) => {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
    if (balances) {
      void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
      void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
    }
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="form-error" role="alert">
      {message}
    </p>
  )
}

function EditSection({ view, sender }: { view: CampaignView; sender: Sender }) {
  const { address: campaign, summary, symbol } = view
  const refresh = useRefresh(campaign)
  const tx = useTx(() => refresh())
  const [title, setTitle] = useState(summary.meta.title)
  const [description, setDescription] = useState(summary.meta.description)
  const [imageUrl, setImageUrl] = useState(summary.meta.imageUrl)
  const [links, setLinks] = useState<string[]>(summary.meta.links.length > 0 ? [...summary.meta.links] : [''])
  const [goal, setGoal] = useState(formatUnits(summary.goal, 6))

  // backup is not part of edit(), so it is left empty here.
  const result = validateCampaign({ title, description, imageUrl, links, goal, token: symbol, backup: '', sender: sender.address })
  const errors = result.ok ? {} : result.errors
  const closed = summary.closed
  const canSubmit = result.ok && !closed && !tx.locked

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || !result.ok) return
    const { goal: g, meta } = result
    void tx.run(sender, () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'edit', args: [g, meta] }) }), 'Edit')
  }

  return (
    <Panel title="Edit details" headingId="edit-heading">
      {closed && <p className="form-hint">This Fundit is closed, so its details can no longer be changed.</p>}
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="form-fields" disabled={closed || tx.locked}>
          <Field label="Title" id="edit-title" hint={<span className="form-counter">{byteLength(title.trim())} of {MAX_TITLE} bytes</span>} error={errors.title} alert>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field
            label="Description"
            id="edit-description"
            hint={<span className="form-counter">{byteLength(description)} of {MAX_DESCRIPTION} bytes</span>}
            error={errors.description}
            alert
          >
            <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Image link (optional)" id="edit-image" error={errors.imageUrl} alert>
            <input type="url" inputMode="url" placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </Field>
          <fieldset className="form-group">
            <legend className="form-legend">Links (optional)</legend>
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
                      onChange={(e) => setLinks((rows) => rows.map((r, j) => (j === i ? e.target.value : r)))}
                      aria-invalid={errors[`link-${i}`] ? true : undefined}
                      aria-describedby={errors[`link-${i}`] ? `edit-link-${i}-error` : undefined}
                    />
                    <Button
                      variant="secondary"
                      aria-label={`Remove link ${i + 1}`}
                      onClick={() => setLinks((rows) => (rows.length === 1 ? [''] : rows.filter((_, j) => j !== i)))}
                    >
                      Remove
                    </Button>
                  </div>
                  <FieldError id={`edit-link-${i}-error`} message={errors[`link-${i}`]} />
                </div>
              ))}
            </div>
            {links.length < MAX_LINKS && (
              <Button variant="secondary" className="manage-add-link" onClick={() => setLinks((rows) => [...rows, ''])}>
                Add a link
              </Button>
            )}
            <FieldError id="edit-links-error" message={errors.links} />
          </fieldset>
          <Field label="Goal" id="edit-goal" error={errors.goal} alert>
            <AmountInput id="edit-goal" currency={symbol} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
        </fieldset>
        <TxStatus tx={tx} noun="edit" successText="Your changes are saved." startOverWarning={RETRY_WARNING} />
        <Button type="submit" block disabled={!canSubmit}>
          {tx.busy ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </Panel>
  )
}

function WithdrawSection({ view, sender }: { view: CampaignView; sender: Sender }) {
  const { address: campaign, summary, symbol } = view
  const queryClient = useQueryClient()
  const refresh = useRefresh(campaign)
  const [amountText, setAmountText] = useState('')
  // What the last submit sent, read once its receipt is in.
  const sending = useRef<{ dest: PayoutDest; fast: boolean; net: bigint } | null>(null)
  // The success text for the last payout. A payout to another chain is only burned on Arc so far.
  const [sentText, setSentText] = useState('Your withdrawal went through.')
  const tx = useTx((hash) => {
    refresh(true)
    setAmountText('')
    const sent = sending.current
    if (sent && sent.dest !== 'Arc') {
      savePendingPayout({ campaign, burnTx: hash, destDomain: destDomain(sent.dest), amount: formatUnits(sent.net, 6) })
      setSentText(`Sent from Arc. It arrives on ${CHAIN_LABELS[sent.dest]} in about ${sent.fast ? 'a minute' : '15 to 20 minutes'}.`)
    } else {
      setSentText('Your withdrawal went through.')
    }
  })
  const [dest, setDest] = useState<PayoutDest>('Arc')
  const [fastChoice, setFastChoice] = useState(true)
  // null until the person types, so the connected address is the default.
  const [recipientText, setRecipientText] = useState<string | null>(null)

  const options = useQuery({
    queryKey: ['payout-options', campaign.toLowerCase()],
    queryFn: () =>
      payoutOptions(view, (d) => arcClient.readContract({ address: campaign, abi: campaignAbi, functionName: 'canPayoutTo', args: [d] })),
    staleTime: Infinity,
  })
  // Arc always works, so it is the only choice while the list loads or if it fails.
  const destinations = options.data ?? ['Arc']

  const crossChain = dest !== 'Arc'
  const chain = crossChain ? chainByKey(dest) : null
  const fast = fastChoice && chain !== null && chain.fast
  const available = summary.available
  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const overAvailable = amount !== null && amount > available
  const net = amount === null ? null : netAfterWithdrawFee(amount, summary.withdrawFeeBps)

  const typed = parseTypedAddress((recipientText ?? sender.address).trim())
  let recipientError: string | undefined
  if (!typed.ok) recipientError = typed.error === 'typo' ? ADDRESS_TYPO : 'Enter a valid address: 0x and 40 characters.'
  else if (isAddressEqual(typed.address, zeroAddress)) recipientError = 'Enter a recipient address.'
  else if (isAddressEqual(typed.address, campaign)) recipientError = 'Choose a different recipient.'
  const recipient: Address | null = typed.ok && !recipientError ? typed.address : null

  const [quoteNet, setQuoteNet] = useState<bigint | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuoteNet(net), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [net])
  const fee = useQuery({
    queryKey: ['payout-fee', dest, fast, quoteNet?.toString()],
    queryFn: () => fetchForwardFee(ARC_DOMAIN, destDomain(dest), quoteNet!, fast),
    enabled: crossChain && quoteNet !== null && quoteNet > 0n,
    staleTime: 30_000,
    retry: 1,
  })
  const quote = crossChain && net !== null && quoteNet === net ? fee.data : undefined
  const arrives = net !== null && quote ? net - quote.maxFee : null
  const tooSmall = arrives !== null && arrives <= 0n

  const canSubmit =
    available > 0n &&
    amount !== null &&
    !overAvailable &&
    recipient !== null &&
    !tx.locked &&
    (!crossChain || (quote !== undefined && !tooSmall))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || amount === null || net === null || recipient === null || tx.locked) return
    sending.current = { dest, fast, net }
    void tx.run(
      sender,
      async () => {
        // A fresh quote at send time, so the fee cap matches what Circle charges now.
        const fresh = crossChain ? await fetchForwardFee(ARC_DOMAIN, destDomain(dest), net, fast) : undefined
        if (fresh && quote && fresh.maxFee > quote.maxFee) {
          // Show the new fee in the breakdown, so the organiser confirms what will really be charged.
          queryClient.setQueryData(['payout-fee', dest, fast, net.toString()], fresh)
          throw new PlainError(fresh.maxFee >= net ? TOO_SMALL : FEE_CHANGED)
        }
        // Defensive: unreachable while submit needs a preview that covers the fee and a higher fee stops above.
        if (fresh && fresh.maxFee >= net) throw new PlainError(TOO_SMALL)
        return buildWithdrawCall({ campaign, amount, dest, recipient, fee: fresh, fast })
      },
      'Withdraw',
    )
  }

  return (
    <Panel title="Withdraw" headingId="withdraw-heading">
      <p>
        Available: <strong>{formatAmount(available, symbol)}</strong>
      </p>
      {available === 0n && <p className="form-hint">There is nothing to withdraw yet.</p>}
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="form-fields" disabled={tx.locked}>
          <div className="form-group">
            <div className="form-row">
              <Field label="Amount" id="withdraw-amount">
                <AmountInput
                  id="withdraw-amount"
                  currency={symbol}
                  placeholder="0"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  aria-invalid={(parsed && !parsed.ok) || overAvailable ? true : undefined}
                  aria-describedby="withdraw-amount-error"
                />
              </Field>
              <Button variant="secondary" disabled={available === 0n} onClick={() => setAmountText(formatUnits(available, 6))}>
                Max
              </Button>
            </div>
            <FieldError
              id="withdraw-amount-error"
              message={
                parsed && !parsed.ok
                  ? parsed.error
                  : overAvailable
                    ? `That is more than the ${formatAmount(available, symbol)} available.`
                    : undefined
              }
            />
          </div>

          <div className="form-group">
            <Field label="Send to" id="withdraw-dest">
              <select className="select" value={dest} onChange={(e) => setDest(e.target.value as PayoutDest)}>
                {destinations.map((d) => (
                  <option key={d} value={d}>
                    {CHAIN_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            {symbol === 'EURC' && destinations.length === 1 && <p className="form-hint">EURC can only be paid out on Arc.</p>}
            {crossChain && <p className="form-hint">{CROSS_CHAIN_NOTE}</p>}
          </div>

          {chain && (
            <fieldset className="form-group">
              <legend className="form-legend">Speed</legend>
              {chain.fast && (
                <label className="form-choice">
                  <input type="radio" name="withdraw-speed" checked={fast} onChange={() => setFastChoice(true)} />
                  <span className="form-choice-text">
                    Fast <span className="form-hint">About a minute. Costs a little more.</span>
                  </span>
                </label>
              )}
              <label className="form-choice">
                <input type="radio" name="withdraw-speed" checked={!fast} onChange={() => setFastChoice(false)} />
                <span className="form-choice-text">
                  Standard <span className="form-hint">Can take 15 minutes or more.</span>
                </span>
              </label>
            </fieldset>
          )}

          <Field
            label="Recipient"
            id="withdraw-recipient"
            hint={crossChain ? `The address that gets the USDC on ${CHAIN_LABELS[dest]}.` : 'The address that gets the funds on Arc.'}
            error={recipientError}
            alert
          >
            <input autoComplete="off" spellCheck={false} value={recipientText ?? sender.address} onChange={(e) => setRecipientText(e.target.value)} />
          </Field>
        </fieldset>

        {amount !== null && net !== null && !overAvailable && (
          <dl className="form-breakdown" aria-label="Breakdown">
            <div>
              <dt>Fundit fee ({bpsToPercent(summary.withdrawFeeBps)})</dt>
              <dd>{formatAmount(amount - net, symbol)}</dd>
            </div>
            {crossChain ? (
              <>
                <div>
                  <dt>Transfer fee (at most)</dt>
                  <dd>{quote ? formatAmount(quote.maxFee, symbol) : fee.isError ? 'Not available' : 'Loading...'}</dd>
                </div>
                <div className="form-total">
                  <dt>Arrives on {CHAIN_LABELS[dest]}</dt>
                  <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, symbol)}` : '-'}</dd>
                </div>
              </>
            ) : (
              <div className="form-total">
                <dt>You receive</dt>
                <dd>{formatAmount(net, symbol)}</dd>
              </div>
            )}
          </dl>
        )}
        {tooSmall && <p className="form-error">{TOO_SMALL}</p>}
        {crossChain && fee.isError && <p className="form-error">Could not get a fee quote from Circle. Try again in a moment.</p>}

        <TxStatus
          tx={tx}
          noun="withdrawal"
          successText={sentText}
          startOverWarning="The earlier withdrawal may still go through. If it does and you withdraw again, you will take out funds twice. Start over anyway?"
        />
        {tx.phase.kind !== 'timeout' && (
          <Button type="submit" block disabled={!canSubmit}>
            {tx.busy ? 'Withdrawing...' : 'Withdraw'}
          </Button>
        )}
      </form>
      <PendingBridgeTracker campaign={campaign} account={sender.address} kind="payout" />
    </Panel>
  )
}

// sweep() returns a token the Fundit does not take. The app knows one: EURC on a USDC Fundit, USDC on a EURC Fundit.
function RescueSection({ view, sender }: { view: CampaignView; sender: Sender }) {
  const { address: campaign, symbol } = view
  const other = TOKENS[symbol === 'USDC' ? 'EURC' : 'USDC']
  const refresh = useRefresh(campaign)
  // The text for the last rescue, set at send time, since the balance reads 0 once it is done.
  const [sentText, setSentText] = useState('')
  // Under ['campaign', campaign], so refresh() reads it again.
  const balance = useQuery({
    queryKey: ['campaign', campaign.toLowerCase(), 'stray', other.symbol],
    queryFn: () => arcClient.readContract({ address: other.address, abi: erc20Abi, functionName: 'balanceOf', args: [campaign] }),
  })
  // The money may go to the Fundit account, so its balance is read again too.
  const tx = useTx(() => refresh(true))
  // null until the person types, so the organiser's Fundit account is the default.
  const [recipientText, setRecipientText] = useState<string | null>(null)

  const amount = balance.data ?? 0n
  // Stays up after a rescue, so the result and its explorer link stay visible.
  if (amount === 0n && tx.phase.kind === 'idle') return null

  const shown = formatAmount(amount, other.symbol)
  const typed = parseTypedAddress((recipientText ?? sender.address).trim())
  let recipientError: string | undefined
  if (!typed.ok) recipientError = typed.error === 'typo' ? ADDRESS_TYPO : 'Enter a valid address: 0x and 40 characters.'
  else if (isAddressEqual(typed.address, zeroAddress)) recipientError = 'Enter a recipient address.'
  else if (isAddressEqual(typed.address, campaign)) recipientError = 'Choose a different recipient.'
  const recipient: Address | null = typed.ok && !recipientError ? typed.address : null
  const canSubmit = amount > 0n && recipient !== null && !tx.locked

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || recipient === null) return
    setSentText(`Sent ${shown}.`)
    void tx.run(
      sender,
      () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'sweep', args: [other.address, recipient] }) }),
      'Rescue',
    )
  }

  return (
    <Panel
      title="Rescue tokens sent by mistake"
      headingId="rescue-heading"
      description={
        amount > 0n && (
          <p>
            Someone sent {shown} to this Fundit. It only accepts {symbol}, so this money is not part of what was raised. You can
            send it to any address on Arc.
          </p>
        )
      }
    >
      {amount > 0n && (
        <form className="form" onSubmit={submit} noValidate>
          <fieldset className="form-fields" disabled={tx.locked}>
            <Field label="Send to" id="rescue-recipient" error={recipientError} alert>
              <input autoComplete="off" spellCheck={false} value={recipientText ?? sender.address} onChange={(e) => setRecipientText(e.target.value)} />
            </Field>
          </fieldset>
          {tx.phase.kind !== 'timeout' && (
            <Button type="submit" block disabled={!canSubmit}>
              {tx.busy ? 'Sending...' : `Rescue ${shown}`}
            </Button>
          )}
        </form>
      )}
      <TxStatus
        tx={tx}
        noun="transaction"
        successText={sentText}
        startOverWarning="The earlier rescue may still go through. Start over anyway?"
      />
    </Panel>
  )
}

function CloseSection({ view, sender }: { view: CampaignView; sender: Sender }) {
  const refresh = useRefresh(view.address)
  const tx = useTx(() => refresh())

  function close() {
    if (tx.locked || !window.confirm(`${CLOSE_TEXT} Close this Fundit?`)) return
    void tx.run(sender, () => ({ to: view.address, data: encodeFunctionData({ abi: campaignAbi, functionName: 'close' }) }), 'Close')
  }

  return (
    <Panel
      title="Close this Fundit"
      headingId="close-heading"
      description={view.summary.closed ? 'This Fundit is closed. It no longer takes donations.' : 'Closing stops new donations.'}
    >
      {!view.summary.closed && (
        <>
          <p>
            <strong>{CLOSE_TEXT}</strong>
          </p>
          <Button variant="danger" block disabled={tx.locked} onClick={close}>
            Close this Fundit
          </Button>
        </>
      )}
      <TxStatus tx={tx} noun="transaction" successText="The Fundit is closed." startOverWarning={RETRY_WARNING} />
    </Panel>
  )
}

function BackupSection({ view, sender }: { view: CampaignView; sender: Sender }) {
  const { address: campaign, summary } = view
  const refresh = useRefresh(campaign)
  const [text, setText] = useState('')
  const tx = useTx(() => {
    refresh()
    setText('')
  })

  const hasBackup = summary.backup !== zeroAddress
  const pending = summary.recoveryReadyAt !== 0n
  const raw = text.trim()
  const typed = raw === '' ? null : parseTypedAddress(raw)
  let error: string | undefined
  if (typed && !typed.ok) error = typed.error === 'typo' ? ADDRESS_TYPO : 'Enter a valid address: 0x and 40 characters.'
  else if (typed?.ok && isAddressEqual(typed.address, sender.address)) error = 'Use a different address from your Fundit account.'
  else if (typed?.ok && isAddressEqual(typed.address, zeroAddress)) error = 'Use Remove backup to remove it.'

  const setBackup = (backup: Address, label: string) =>
    tx.run(sender, () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'setBackup', args: [backup] }) }), label)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!typed?.ok || error || tx.locked) return
    void setBackup(typed.address, 'Set backup')
  }

  return (
    <Panel
      title="Backup address"
      headingId="backup-heading"
      description="If you lose your Fundit account, the backup address can ask to take over the Fundit. It becomes the organiser after a 7-day wait, and you can cancel from your Fundit account during those 7 days."
    >
      <div className="manage-current">
        <span>Current backup:</span>
        {hasBackup ? <AddressChip address={summary.backup} full /> : <span>None</span>}
      </div>

      {pending && (
        <StatusBox>
          <p>
            <strong>Your backup started a recovery.</strong> It can take over on{' '}
            {new Date(Number(summary.recoveryReadyAt) * 1000).toLocaleString()}. If you did not expect this, cancel it now.
          </p>
          <div className="form-actions">
            <Button
              disabled={tx.locked}
              onClick={() =>
                void tx.run(
                  sender,
                  () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'cancelRecovery' }) }),
                  'Cancel recovery',
                )
              }
            >
              Cancel recovery
            </Button>
          </div>
        </StatusBox>
      )}

      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="form-fields" disabled={tx.locked}>
          <Field
            label="New backup address"
            id="backup-new"
            hint={pending ? 'Changing or removing the backup also cancels the recovery.' : undefined}
            error={error}
            alert
          >
            <input autoComplete="off" spellCheck={false} placeholder="0x..." value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </fieldset>
        {hasBackup ? (
          <Actions>
            <Button variant="secondary" disabled={tx.locked} onClick={() => void setBackup(zeroAddress, 'Remove backup')}>
              Remove backup
            </Button>
            <Button type="submit" disabled={raw === '' || error !== undefined || tx.locked}>
              Save backup
            </Button>
          </Actions>
        ) : (
          <Button type="submit" block disabled={raw === '' || error !== undefined || tx.locked}>
            Save backup
          </Button>
        )}
        <TxStatus tx={tx} noun="transaction" successText="Saved." startOverWarning={RETRY_WARNING} />
      </form>
    </Panel>
  )
}

export function Manage() {
  const { address: param = '' } = useParams()
  const valid = isAddress(param)
  const query = useCampaign(valid ? param : undefined)
  const sender = useSender()

  if (!valid || query.data === 'not-a-campaign') return <NotFound fundit />

  if (query.isError) {
    return (
      <div className="manage">
        <PageHeader title="Could not load this Fundit" />
        <EmptyState
          action={
            <Button variant="secondary" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          <p>The Arc network did not answer. Check your connection and try again.</p>
        </EmptyState>
      </div>
    )
  }
  if (query.isPending || !query.data) {
    return (
      <div className="manage" aria-busy="true">
        <p className="form-hint">Loading Fundit...</p>
      </div>
    )
  }
  const view = query.data
  if (!sender) return <SignInRequired text="Sign in with the Fundit account that started this Fundit to manage it." />
  if (!isAddressEqual(sender.address, view.summary.creator)) {
    // Only the organiser can sign these calls. Anyone else sees the public page.
    return <Navigate to={`/c/${view.address}`} replace />
  }

  // Two columns on a wide screen: the money and the backup on the left, the details and Close on the right. On a
  // phone the columns stack in the same order, so Close this Fundit comes last.
  return (
    <div className="manage">
      <PageHeader title="Manage this Fundit" subtitle={<Link to={`/c/${view.address}`}>{view.summary.meta.title || 'Untitled Fundit'}</Link>} />
      <div className="manage-grid">
        <div className="manage-col">
          <WithdrawSection view={view} sender={sender} />
          <RescueSection view={view} sender={sender} />
          <BackupSection view={view} sender={sender} />
        </div>
        <div className="manage-col">
          <EditSection view={view} sender={sender} />
          <CloseSection view={view} sender={sender} />
        </div>
      </div>
    </div>
  )
}
