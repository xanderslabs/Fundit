import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Hex } from 'viem'
import { EOA_GAS_RESERVE, EXPLORER_URL } from '../config'
import { useSender } from '../hooks/useSender'
import {
  clearPendingArc,
  notifyPending,
  type PendingArc,
  pendingArc,
  savePendingArc,
  subscribePending,
} from '../lib/bridge'
import { markAnonymous, messageLimit } from '../lib/anon'
import type { CampaignView } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { BALANCES_KEY, balancesKey, fetchAccountBalances } from '../lib/deposit'
import { buildDonateCalls, donationBreakdown, fetchDonorFunds } from '../lib/donate'
import { confirmLine } from '../lib/account'
import { addAtLeast, CANCELLED, CHECK_FAILED, explainError, needsAddMoney } from '../lib/errors'
import { bpsToPercent, formatAmount, formatExact, parseAmount } from '../lib/format'
import type { TxResult } from '../lib/sender'
import { ADD_MONEY_PATH } from '../lib/urls'
import { byteLength } from '../lib/validate'
import { SignInButton } from './AccountMenu'
import { AddMoneyLink, recheckResult } from './TxStatus'
import { AmountInput, Button, Card, Field, StatusBox } from './ui'
import './DonatePanel.css'

const QUICK_AMOUNTS = ['10', '25', '50', '100'] as const
const TIP_PERCENTS = [0, 5, 10, 15] as const
const DAY_MS = 24 * 60 * 60 * 1000
const START_OVER_WARNING =
  'The earlier transaction may still go through. If it does and you give again, you will give twice. Start a new donation anyway?'

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking' }
  | { kind: 'success'; hash: Hex }
  // note explains a re-check that failed to answer. The outcome is still unknown, so this phase still blocks.
  | { kind: 'timeout'; hash: Hex; note?: string }
  | { kind: 'error'; message: string; hash?: Hex; addMoney?: boolean }

function arcTimeout(saved: PendingArc): Phase {
  const note = Date.now() - saved.createdAt > DAY_MS ? 'This was more than a day ago. Check the explorer before giving again.' : undefined
  return { kind: 'timeout', hash: saved.hash, note }
}

function ExplorerLink({ hash }: { hash: Hex }) {
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      View it on the Arc explorer
    </a>
  )
}

export function DonatePanel({ view }: { view: CampaignView }) {
  const { address: campaign, summary, symbol } = view
  const token = summary.token
  const closed = summary.closed
  const sender = useSender()
  const queryClient = useQueryClient()

  const [amountText, setAmountText] = useState('')
  const [tipPercent, setTipPercent] = useState<(typeof TIP_PERCENTS)[number]>(0)
  const [message, setMessage] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  // Re-read the shared pending store on every change, from this tab or another. A donation another tab left
  // unconfirmed puts this form into its not-confirmed state, unless this tab is sending or checking its own.
  // Only donations block: gifts come from the Fundit account on Arc, so a transfer from another chain saved
  // by an older build is not a gift that could land twice.
  useEffect(() => {
    const reload = () => {
      const saved = pendingArc(campaign)
      if (saved) setPhase((p) => (p.kind === 'sending' || p.kind === 'checking' || p.kind === 'timeout' ? p : arcTimeout(saved)))
    }
    reload()
    return subscribePending(reload)
  }, [campaign])
  // An unconfirmed donation saved before a reload still blocks a new one until it is settled.
  const [phase, setPhase] = useState<Phase>(() => {
    const saved = pendingArc(campaign)
    return saved ? arcTimeout(saved) : { kind: 'idle' }
  })
  // Set synchronously, so a second click before React re-renders cannot start a second send or check.
  const inFlight = useRef(false)

  // Keep the unconfirmed transaction across reloads. Forget it once an outcome is known or the donor starts over.
  useEffect(() => {
    if (phase.kind === 'timeout') savePendingArc({ campaign, hash: phase.hash })
    else if (phase.kind !== 'sending' && phase.kind !== 'checking') clearPendingArc(campaign)
  }, [phase, campaign])

  const fundsKey = ['donor-funds', token.toLowerCase(), sender?.address.toLowerCase(), campaign.toLowerCase()]
  const funds = useQuery({
    queryKey: fundsKey,
    queryFn: () => fetchDonorFunds(arcClient, token, sender!.address, campaign),
    enabled: sender !== null && !closed,
    staleTime: 15_000,
  })

  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const tip = amount === null ? 0n : (amount * BigInt(tipPercent)) / 100n
  const breakdown = amount === null ? null : donationBreakdown(amount, tip, summary.donationFeeBps)
  const messageBytes = byteLength(message)
  const limit = messageLimit(anonymous)
  const messageTooLong = messageBytes > limit
  const balance = funds.data?.balance
  // What the account keeps for the network fee. Only a USDC balance pays it.
  const gasBuffer = sender !== null && symbol === 'USDC' ? EOA_GAS_RESERVE : 0n
  // An EURC gift from any account still pays the network fee in USDC, so it needs the buffer in USDC.
  const needsGasUsdc = sender !== null && symbol !== 'USDC'
  const gasFunds = useQuery({
    queryKey: balancesKey(sender?.address ?? null),
    queryFn: () => fetchAccountBalances(arcClient, sender!.address),
    enabled: needsGasUsdc && !closed,
    staleTime: 15_000,
  })
  const noGas = needsGasUsdc && gasFunds.data !== undefined && gasFunds.data.usdc < EOA_GAS_RESERVE
  const overBalance = breakdown !== null && balance !== undefined && breakdown.total + gasBuffer > balance
  const notEnough = (have: bigint, keep = gasBuffer) =>
    keep > 0n
      ? `Your balance is ${formatAmount(have, symbol)}. Keep about ${formatExact(keep, symbol)} more for the network fee, which your Fundit account pays in USDC.`
      : `Your balance is ${formatAmount(have, symbol)}, which is not enough ${symbol} for this amount and tip.`

  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  // An unconfirmed transaction may still be mined. Until a check settles it, no new donation can start.
  const unconfirmed = phase.kind === 'timeout'
  const locked = busy || unconfirmed
  const canSubmit =
    !closed &&
    sender !== null &&
    amount !== null &&
    !messageTooLong &&
    balance !== undefined &&
    !overBalance &&
    (!needsGasUsdc || (gasFunds.data !== undefined && !noGas)) &&
    !locked

  function refreshAfterDonation() {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
  }

  function handle(res: TxResult) {
    if (res.status === 'success') {
      refreshAfterDonation()
      setAmountText('')
      setMessage('')
      setTipPercent(0)
      setPhase({ kind: 'success', hash: res.hash })
      return
    }
    if (res.status === 'timeout') {
      // A wallet or email batch (one Multicall3From transaction) runs the approval and the donation together, so
      // its timeout is the donation's.
      setPhase({ kind: 'timeout', hash: res.hash })
      return
    }
    if (res.status === 'reverted') setPhase({ kind: 'error', message: res.error, hash: res.hash })
    else setPhase({ kind: 'error', message: CANCELLED })
  }

  async function donate() {
    if (inFlight.current || !canSubmit || !sender || amount === null) return
    // Another tab may have started a donation to this campaign since this form loaded. Read the store again
    // before anything is sent; the listeners then show that donation's blocked state.
    if (pendingArc(campaign)) {
      notifyPending()
      return
    }
    inFlight.current = true
    setPhase({ kind: 'sending' })
    try {
      // Read the balance and allowance again right before building, so a finished approval is not repeated.
      const fresh = await fetchDonorFunds(arcClient, token, sender.address, campaign)
      queryClient.setQueryData(fundsKey, fresh)
      if (fresh.balance < amount + tip) {
        setPhase({ kind: 'error', message: notEnough(fresh.balance, 0n) })
        return
      }
      const calls = buildDonateCalls({ campaign, token, amount, tip, message: anonymous ? markAnonymous(message) : message, allowance: fresh.allowance })
      const donateIndex = calls.length - 1
      const res = await sender.send(calls, {
        label: 'Donate',
        // Saved as soon as the donation has a hash, so a reload before the receipt still blocks a second one.
        // The approval alone moves nothing to the campaign, so its hash is not saved.
        onHash: (hash, index) => {
          if (index === donateIndex) savePendingArc({ campaign, hash })
        },
      })
      handle(res)
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err), addMoney: needsAddMoney(err) })
    } finally {
      inFlight.current = false
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  // Checks the same transaction again. It never sends a new one, which could donate twice.
  async function checkAgain(hash: Hex) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking' })
    try {
      const res = await recheckResult(hash)
      handle(res)
    } catch (err) {
      // The check itself failed, so the transaction is still unknown. Stay blocked rather than invite a second send.
      console.error(err)
      setPhase({ kind: 'timeout', hash, note: CHECK_FAILED })
    } finally {
      inFlight.current = false
    }
  }

  // The donor chooses to stop waiting. They confirm that the earlier transaction may still go through.
  function startOver() {
    const ok = window.confirm(START_OVER_WARNING)
    if (!ok) return
    setAmountText('')
    setMessage('')
    setTipPercent(0)
    setPhase({ kind: 'idle' })
  }

  let balanceNote: string | null = null
  if (sender && !closed) {
    if (funds.isError) balanceNote = 'Could not read your balance. Check your connection.'
    else if (balance !== undefined) balanceNote = `Your balance: ${formatAmount(balance, symbol)}`
    else balanceNote = 'Reading your balance...'
  }

  return (
    <Card className="give" label="Give">
      <h2 className="give-title">Give</h2>
      {closed && <p className="give-error">This Fundit is closed.</p>}
      <form className="give-form" onSubmit={submit} noValidate>
        <fieldset className="give-fields" disabled={closed || locked}>
          <div className="give-amount">
            <Field label="Amount" id="donate-amount">
              <AmountInput
                id="donate-amount"
                currency={symbol}
                placeholder="25"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={parsed && !parsed.ok ? true : undefined}
                aria-describedby="donate-amount-error donate-funds-error donate-gas-error donate-balance"
              />
            </Field>
            <div className="give-quick" role="group" aria-label="Quick amounts">
              {QUICK_AMOUNTS.map((q) => (
                <Button key={q} variant="secondary" onClick={() => setAmountText(q)}>
                  {q}
                </Button>
              ))}
            </div>
            {parsed && !parsed.ok && (
              <p id="donate-amount-error" className="give-error" role="alert">
                {parsed.error}
              </p>
            )}
            {overBalance && balance !== undefined && (
              <p id="donate-funds-error" className="give-error" role="alert">
                {notEnough(balance)} <Link to={ADD_MONEY_PATH}>Add money</Link>
              </p>
            )}
            {noGas && (
              <p id="donate-gas-error" className="give-error" role="alert">
                {addAtLeast(EOA_GAS_RESERVE)} <Link to={ADD_MONEY_PATH}>Add money</Link>
              </p>
            )}
            {/* An amount error already states the balance, so the plain balance line would repeat it. */}
            {balanceNote && !(parsed && !parsed.ok) && !overBalance && !noGas && (
              <p id="donate-balance" className="give-hint">
                {balanceNote}
              </p>
            )}
          </div>

          <fieldset className="give-tips">
            <legend className="give-legend">Tip Fundit (optional)</legend>
            <div className="give-tip-options">
              {TIP_PERCENTS.map((pct) => (
                <label key={pct} className="give-tip">
                  <input type="radio" name="donate-tip" checked={tipPercent === pct} onChange={() => setTipPercent(pct)} />
                  <span>{`${pct}%`}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="give-message">
            <Field label="Message (optional)" id="donate-message">
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-invalid={messageTooLong ? true : undefined}
                aria-describedby="donate-message-count"
              />
            </Field>
            <div className="give-message-meta">
              <label className="give-switch">
                <input type="checkbox" role="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                <span className="give-switch-track" aria-hidden="true" />
                <span>Hide my name</span>
              </label>
              <span id="donate-message-count" className={messageTooLong ? 'give-counter give-counter-over' : 'give-counter'}>
                {messageBytes} of {limit} bytes
              </span>
            </div>
          </div>

        </fieldset>

        {breakdown && (
          <dl className="give-breakdown" aria-label="Breakdown">
            <div>
              <dt>To the Fundit</dt>
              <dd>{formatExact(breakdown.toCampaign, symbol)}</dd>
            </div>
            <div>
              <dt>Platform fee ({bpsToPercent(summary.donationFeeBps)})</dt>
              <dd>{formatExact(breakdown.fee, symbol)}</dd>
            </div>
            <div>
              <dt>Tip for Fundit</dt>
              <dd>{formatExact(breakdown.tip, symbol)}</dd>
            </div>
            <div className="give-total">
              <dt>Total you pay</dt>
              <dd>{formatExact(breakdown.total, symbol)}</dd>
            </div>
          </dl>
        )}

        {/* status-error stays on the error boxes: the e2e suite finds a failed send by it. */}
        <div className="give-status" aria-live="polite">
          {phase.kind === 'sending' && sender && <p>{confirmLine(sender.kind)}, then wait for the network. This can take a few seconds.</p>}
          {phase.kind === 'checking' && <p>Checking the transaction again...</p>}
          {phase.kind === 'success' && (
            <StatusBox tone="success">
              <p>
                <strong>Thank you. Your donation went through.</strong>
              </p>
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
            </StatusBox>
          )}
          {phase.kind === 'timeout' && (
            <StatusBox>
              <p>
                <strong>Your donation is not confirmed yet.</strong> It may still go
                through. Check it before you try again, so you do not give twice.
              </p>
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
              {phase.note && <p className="give-error">{phase.note}</p>}
              <div className="give-actions">
                <Button variant="secondary" onClick={() => checkAgain(phase.hash)}>
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

        {/* Signed out, the sign-in button sits after the form: its dialog holds a form of its own. */}
        {unconfirmed || (!sender && !closed) ? null : (
          <Button type="submit" size="lg" block disabled={!canSubmit}>
            {busy ? 'Giving...' : 'Give'}
          </Button>
        )}
      </form>
      {!unconfirmed && !sender && !closed && (
        <SignInButton className="ui-btn ui-btn-primary ui-btn-lg ui-btn-block give-signin" label="Sign in to give" />
      )}
    </Card>
  )
}
