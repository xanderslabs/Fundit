import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import type { Hex } from 'viem'
import { arc } from 'viem/chains'
import { MAX_MESSAGE_BYTES, TX_TIMEOUT_MS } from '../config'
import { useSender } from '../hooks/useSender'
import type { CampaignView } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { buildDonateCalls, donationBreakdown, fetchDonorFunds } from '../lib/donate'
import { explainError } from '../lib/errors'
import { bpsToPercent, formatAmount, parseAmount } from '../lib/format'
import { arcReceipts, type TxResult, waitForResult } from '../lib/sender'
import { byteLength } from '../lib/validate'

const EXPLORER_URL = arc.blockExplorers.default.url
const QUICK_AMOUNTS = ['10', '25', '50', '100'] as const
const TIP_PERCENTS = [0, 5, 10, 15] as const

// Where the money comes from. Later tasks add sources here (other chains, passkey, Gateway).
type PaySourceId = 'arc'
type PaySource = { id: PaySourceId; label: string; hint: string }
const PAY_SOURCES: readonly PaySource[] = [{ id: 'arc', label: 'Arc wallet', hint: 'Pay from your connected wallet on Arc.' }]

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking' }
  | { kind: 'success'; hash: Hex }
  // approve is true when the transaction that timed out is the approval, not the donation.
  | { kind: 'timeout'; hash: Hex; approve: boolean }
  // The approval is mined but the donation was not sent (cancelled or failed).
  | { kind: 'partial'; error?: string }
  | { kind: 'error'; message: string; hash?: Hex }

function ExplorerLink({ hash }: { hash: Hex }) {
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      View it on the Arc explorer
    </a>
  )
}

function ConnectPrompt() {
  const { open } = useAppKit()
  return (
    <button type="button" className="btn btn-lg donate-submit" onClick={() => open()}>
      Connect wallet to donate
    </button>
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
  const [source, setSource] = useState<PaySourceId>('arc')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

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
  const messageTooLong = messageBytes > MAX_MESSAGE_BYTES
  const balance = funds.data?.balance
  const overBalance = breakdown !== null && balance !== undefined && breakdown.total > balance

  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  const canSubmit = !closed && sender !== null && amount !== null && !messageTooLong && balance !== undefined && !overBalance && !busy

  function refreshAfterDonation() {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
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
      setPhase({ kind: 'timeout', hash: res.hash, approve: hadApprove && res.completed === 0 })
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
    if (!canSubmit || !sender || amount === null) return
    setPhase({ kind: 'sending' })
    try {
      // Read the balance and allowance again right before building, so a finished approval is not repeated.
      const fresh = await fetchDonorFunds(arcClient, token, sender.address, campaign)
      queryClient.setQueryData(fundsKey, fresh)
      if (fresh.balance < amount + tip) {
        setPhase({ kind: 'error', message: `Your balance is ${formatAmount(fresh.balance, symbol)}, which is not enough ${symbol} for this donation.` })
        return
      }
      const calls = buildDonateCalls({ sender, campaign, token, amount, tip, message, allowance: fresh.allowance })
      handle(await sender.send(calls, { label: 'Donate' }), calls.length > 1)
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err) })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  // Checks the same transaction again. It never sends a new one, which could donate twice.
  async function checkAgain(hash: Hex, approve: boolean) {
    setPhase({ kind: 'checking' })
    const res = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
    if (!approve) return handle(res, false)
    if (res.status === 'success') {
      void queryClient.invalidateQueries({ queryKey: ['donor-funds'] })
      setPhase({ kind: 'partial' })
    } else if (res.status === 'timeout') setPhase({ kind: 'timeout', hash, approve: true })
    else if (res.status === 'reverted') setPhase({ kind: 'error', message: res.error, hash })
  }

  let balanceNote: string | null = null
  if (sender && !closed) {
    if (funds.isError) balanceNote = 'Could not read your balance. Check your connection.'
    else if (balance !== undefined) balanceNote = `Your balance: ${formatAmount(balance, symbol)}`
    else balanceNote = 'Reading your balance...'
  }

  return (
    <section className="panel donate" aria-label="Donate">
      <h2>Donate</h2>
      {closed && <p className="field-error">This campaign is closed.</p>}

      <form className="donate-form" onSubmit={submit} noValidate>
        <fieldset className="donate-fields" disabled={closed || busy}>
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
                Your balance is {formatAmount(balance, symbol)}, which is not enough {symbol} for this amount and tip.
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
            <p className="hint">The tip goes to Fundit, not to the fundraiser.</p>
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
              {messageBytes} of {MAX_MESSAGE_BYTES} bytes
            </span>
            <p className="hint">Your message is public and stays on chain.</p>
          </div>

          <fieldset className="form-field">
            <legend>Pay with</legend>
            {PAY_SOURCES.map((s) => (
              <label key={s.id} className="choice">
                <input type="radio" name="donate-source" checked={source === s.id} onChange={() => setSource(s.id)} />
                <span>
                  {s.label} <span className="hint">{s.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </fieldset>

        {breakdown && (
          <dl className="donate-breakdown" aria-label="Breakdown">
            <div>
              <dt>To the fundraiser</dt>
              <dd>{formatAmount(breakdown.toCampaign, symbol)}</dd>
            </div>
            <div>
              <dt>Platform fee ({bpsToPercent(summary.donationFeeBps)})</dt>
              <dd>{formatAmount(breakdown.fee, symbol)}</dd>
            </div>
            <div>
              <dt>Tip for Fundit</dt>
              <dd>{formatAmount(breakdown.tip, symbol)}</dd>
            </div>
            <div className="donate-total">
              <dt>Total you pay</dt>
              <dd>{formatAmount(breakdown.total, symbol)}</dd>
            </div>
          </dl>
        )}
        {breakdown && <p className="hint">You also pay a small network fee in USDC.</p>}

        <div className="donate-status" aria-live="polite">
          {phase.kind === 'sending' && <p>Confirm in your wallet, then wait for the network. This can take a few seconds.</p>}
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
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
              <button type="button" className="btn btn-outline" onClick={() => checkAgain(phase.hash, phase.approve)}>
                Check again
              </button>
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

        {!sender && !closed ? (
          <ConnectPrompt />
        ) : phase.kind === 'partial' ? (
          <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
            Finish donation
          </button>
        ) : (
          <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
            {busy ? 'Donating...' : 'Donate'}
          </button>
        )}
      </form>
    </section>
  )
}
