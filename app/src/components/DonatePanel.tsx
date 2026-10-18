import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Hex } from 'viem'
import { EXPLORER_URL } from '../config'
import { RESERVE_KEY, usePasskeyReserve } from '../hooks/usePasskeyReserve'
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
import { explainError } from '../lib/errors'
import { bpsToPercent, formatAmount, formatExact, parseAmount } from '../lib/format'
import { addAtLeast, passkeyReserve } from '../lib/passkey'
import type { TxResult } from '../lib/sender'
import { byteLength } from '../lib/validate'
import { SignInButton } from './AccountMenu'
import { PASSKEY_LOGIN_TO_CHECK, PASSKEY_PROCESSING, recheckResult } from './TxStatus'

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
  // approve is true when the transaction that timed out is the approval, not the donation.
  // note explains a re-check that failed to answer. The outcome is still unknown, so this phase still blocks.
  // userop marks a passkey user operation hash: no explorer link, and only the passkey bundler can check it.
  | { kind: 'timeout'; hash: Hex; approve: boolean; userop?: boolean; note?: string }
  // The approval is mined but the donation was not sent (cancelled or failed).
  | { kind: 'partial'; error?: string }
  | { kind: 'error'; message: string; hash?: Hex }

function arcTimeout(saved: PendingArc): Phase {
  const note = Date.now() - saved.createdAt > DAY_MS ? 'This was more than a day ago. Check the explorer before giving again.' : undefined
  return { kind: 'timeout', hash: saved.hash, approve: saved.approve, userop: saved.hashKind === 'userop', note }
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
    if (phase.kind === 'timeout') {
      savePendingArc({ campaign, hash: phase.hash, approve: phase.approve, ...(phase.userop ? { hashKind: 'userop' as const } : {}) })
    }
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
  // What the Fundit account keeps for the network fee (passkeyReserve). Only a USDC balance pays it.
  // Estimated as a gift of the same shape: an approve and a donate of 1 unit.
  const reserve = usePasskeyReserve(sender, {
    key: `donate-${campaign.toLowerCase()}`,
    calls: buildDonateCalls({ campaign, token, amount: 1n, tip: 0n, message: '', allowance: 0n }),
  })
  const gasBuffer = sender?.kind === 'passkey' && symbol === 'USDC' ? (reserve ?? 0n) : 0n
  // An EURC gift from a Fundit account still pays the network fee in USDC, so it needs the buffer in USDC.
  const needsGasUsdc = sender?.kind === 'passkey' && symbol !== 'USDC'
  const gasFunds = useQuery({
    queryKey: balancesKey(sender?.address ?? null),
    queryFn: () => fetchAccountBalances(arcClient, sender!.address),
    enabled: needsGasUsdc && !closed,
    staleTime: 15_000,
  })
  const noGas = needsGasUsdc && gasFunds.data !== undefined && reserve !== undefined && gasFunds.data.usdc < reserve
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
    (sender.kind !== 'passkey' || reserve !== undefined) &&
    !overBalance &&
    (!needsGasUsdc || (gasFunds.data !== undefined && !noGas)) &&
    !locked

  function refreshAfterDonation() {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
    void queryClient.invalidateQueries({ queryKey: [RESERVE_KEY] })
  }

  function handle(res: TxResult, hadApprove: boolean) {
    if (res.status === 'success') {
      refreshAfterDonation()
      setAmountText('')
      setMessage('')
      setTipPercent(0)
      setPhase({ kind: 'success', hash: res.hash })
      return
    }
    if (res.status === 'timeout') {
      // completed counts the calls mined before this one, so 0 with an approval means the approval timed out.
      // A user operation runs the approval and the donation together, so its timeout is the donation's.
      const userop = res.hashKind === 'userop'
      setPhase({ kind: 'timeout', hash: res.hash, approve: !userop && hadApprove && res.completed === 0, userop })
      return
    }
    if (hadApprove && res.completed >= 1) {
      void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
      setPhase({ kind: 'partial', error: res.status === 'reverted' ? res.error : undefined })
      return
    }
    if (res.status === 'reverted') setPhase({ kind: 'error', message: res.error, hash: res.hash })
    else setPhase({ kind: 'error', message: 'You cancelled the request.' })
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
      const calls = buildDonateCalls({ campaign, token, amount, tip, message: anonymous ? markAnonymous(message) : message, allowance: fresh.allowance })
      // The prefund for these exact calls at the fee now, so a gift that would revert in its own calls is never sent.
      const needed = sender.kind === 'passkey' ? await passkeyReserve(sender.address, calls, { feeMargin: false }) : 0n
      const keep = symbol === 'USDC' ? needed : 0n
      if (fresh.balance < amount + tip + keep) {
        setPhase({ kind: 'error', message: notEnough(fresh.balance, keep) })
        return
      }
      if (needsGasUsdc) {
        const gas = await fetchAccountBalances(arcClient, sender.address)
        queryClient.setQueryData(balancesKey(sender.address), gas)
        if (gas.usdc < needed) {
          setPhase({ kind: 'error', message: addAtLeast(needed) })
          return
        }
      }
      const donateIndex = calls.length - 1
      const res = await sender.send(calls, {
        label: 'Donate',
        // Saved as soon as the donation has a hash, so a reload before the receipt still blocks a second one.
        // The approval alone moves nothing to the campaign, so its hash is not saved.
        onHash: (hash, index) => {
          if (index === donateIndex) {
            savePendingArc({ campaign, hash, approve: false, ...(sender.kind === 'passkey' ? { hashKind: 'userop' as const } : {}) })
          }
        },
      })
      handle(res, calls.length > 1)
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err) })
    } finally {
      inFlight.current = false
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  // Checks the same transaction again. It never sends a new one, which could donate twice.
  async function checkAgain(hash: Hex, approve: boolean, userop: boolean) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking' })
    try {
      const res = await recheckResult(sender, hash, userop)
      if (!approve) return handle(res, false)
      switch (res.status) {
        case 'success':
          void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
          setPhase({ kind: 'partial' })
          return
        case 'timeout':
          setPhase({ kind: 'timeout', hash, approve: true, userop })
          return
        case 'reverted':
          setPhase({ kind: 'error', message: res.error, hash })
          return
        case 'rejected':
          // waitForResult never returns this, but the approval is not known to be mined, so start clean.
          setPhase({ kind: 'error', message: 'The approval was not confirmed.', hash })
      }
    } catch (err) {
      // The check itself failed, so the transaction is still unknown. Stay blocked rather than invite a second send.
      setPhase({ kind: 'timeout', hash, approve, userop, note: `We could not check it. ${explainError(err)}` })
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
    <section className="panel donate" aria-label="Give">
      <h2>Give</h2>
      {closed && <p className="field-error">This Fundit is closed.</p>}
      <form className="donate-form" onSubmit={submit} noValidate>
        <fieldset className="donate-fields" disabled={closed || locked}>
          <div className="form-field">
            <label htmlFor="donate-amount">Amount</label>
            <div className="donate-amount">
              <input
                id="donate-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="25"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={parsed && !parsed.ok ? true : undefined}
                aria-describedby="donate-amount-error donate-balance"
              />
              <span className="donate-symbol">{symbol}</span>
            </div>
            <div className="donate-quick" role="group" aria-label="Quick amounts">
              {QUICK_AMOUNTS.map((q) => (
                <button key={q} type="button" className="btn btn-outline" onClick={() => setAmountText(q)}>
                  {q}
                </button>
              ))}
            </div>
            {parsed && !parsed.ok && (
              <p id="donate-amount-error" className="field-error" role="alert">
                {parsed.error}
              </p>
            )}
            {overBalance && balance !== undefined && (
              <p className="field-error" role="alert">
                {notEnough(balance)} <Link to="/add-money">Add money</Link>
              </p>
            )}
            {noGas && reserve !== undefined && (
              <p className="field-error" role="alert">
                {addAtLeast(reserve)} <Link to="/add-money">Add money</Link>
              </p>
            )}
            {balanceNote && (
              <p id="donate-balance" className="hint">
                {balanceNote}
              </p>
            )}
          </div>

          <fieldset className="form-field">
            <legend>Tip for Fundit (optional)</legend>
            <div className="donate-options">
              {TIP_PERCENTS.map((pct) => (
                <label key={pct} className="donate-option">
                  <input type="radio" name="donate-tip" checked={tipPercent === pct} onChange={() => setTipPercent(pct)} />
                  <span>{pct === 0 ? 'No tip' : `${pct}%`}</span>
                </label>
              ))}
            </div>
            <p className="hint">The tip goes to the Fundit team, not to this Fundit.</p>
          </fieldset>

          <div className="form-field">
            <label htmlFor="donate-message">Message (optional)</label>
            <textarea
              id="donate-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-invalid={messageTooLong ? true : undefined}
              aria-describedby="donate-message-count"
            />
            <span id="donate-message-count" className={messageTooLong ? 'counter counter-over' : 'counter'}>
              {messageBytes} of {limit} bytes
            </span>
            <p className="hint">Your message is public and stays on chain.</p>
            <label className="check">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span>Give anonymously</span>
            </label>
            <p className="hint">
              Your name won't show on Fundit. The gift is still recorded on the public blockchain from your wallet address.
            </p>
          </div>

        </fieldset>

        {breakdown && (
          <dl className="donate-breakdown" aria-label="Breakdown">
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
            <div className="donate-total">
              <dt>Total you pay</dt>
              <dd>{formatExact(breakdown.total, symbol)}</dd>
            </div>
          </dl>
        )}
        {breakdown && <p className="hint">You also pay a small network fee in USDC.</p>}

        <div className="donate-status" aria-live="polite">
          {phase.kind === 'sending' && <p>Confirm with your passkey, then wait for the network. This can take a few seconds.</p>}
          {phase.kind === 'checking' && <p>Checking the transaction again...</p>}
          {phase.kind === 'success' && (
            <div className="status-box status-success">
              <p>
                <strong>Thank you. Your donation went through.</strong>
              </p>
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
            </div>
          )}
          {phase.kind === 'timeout' && (
            <div className="status-box">
              <p>
                <strong>Your {phase.approve ? 'approval' : 'donation'} is not confirmed yet.</strong> It may still go
                through. Check it before you try again, so you do not give twice.
              </p>
              <p>{phase.userop ? PASSKEY_PROCESSING : <ExplorerLink hash={phase.hash} />}</p>
              {phase.note && <p className="field-error">{phase.note}</p>}
              {phase.userop && !sender?.recheck && <p className="field-error">{PASSKEY_LOGIN_TO_CHECK}</p>}
              <div className="donate-actions">
                {(!phase.userop || sender?.recheck) && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => checkAgain(phase.hash, phase.approve, phase.userop === true)}
                  >
                    Check again
                  </button>
                )}
                <button type="button" className="btn btn-outline" onClick={startOver}>
                  Start over
                </button>
              </div>
            </div>
          )}
          {phase.kind === 'partial' && (
            <div className="status-box status-error">
              <p>Your approval went through, but the donation was not sent.</p>
              {phase.error && <p>{phase.error}</p>}
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

        {/* Signed out, the sign-in button sits after the form: its dialog holds a form of its own. */}
        {unconfirmed || (!sender && !closed) ? null : phase.kind === 'partial' ? (
          <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
            Finish donation
          </button>
        ) : (
          <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
            {busy ? 'Giving...' : 'Give'}
          </button>
        )}
      </form>
      {!unconfirmed && !sender && !closed && <SignInButton className="btn btn-lg donate-submit" label="Sign in to give" />}
    </section>
  )
}
