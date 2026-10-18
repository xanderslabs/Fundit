import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { type Address, formatUnits, isAddressEqual, zeroAddress } from 'viem'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, PASSKEY_GAS_BUFFER, TOKENS, type TokenSymbol } from '../config'
import { buildAccountSendCalls, maxAccountSend, OWN_ADDRESS, TOO_SMALL } from '../lib/accountWithdraw'
import { chainByKey } from '../lib/bridge'
import { arcClient } from '../lib/clients'
import { BALANCES_KEY, balancesKey, fetchAccountBalances } from '../lib/deposit'
import { PlainError } from '../lib/errors'
import { formatAmount, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { destDomain, type PayoutDest } from '../lib/payout'
import type { Sender } from '../lib/sender'
import { ADDRESS_TYPO, parseTypedAddress } from '../lib/validate'
import { TxStatus, useTx } from './TxStatus'

const FEE_CHANGED = 'The transfer fee changed. Check the new amount and confirm again.'
const QUOTE_DEBOUNCE_MS = 400

// Sends USDC or EURC out of a Fundit account, on Arc or as USDC to another chain. The organiser's payout form
// in Manage is the model: the same fee preview, a fresh quote at send time, and Fast as the default.
// Passkey senders only: they send approve and burn as one user operation. A wallet would send them as two
// transactions, and a failed burn would leave an open approval behind.
export function AccountWithdraw({ sender }: { sender: Sender }) {
  return sender.kind === 'passkey' ? <SendOutForm sender={sender} /> : null
}

function SendOutForm({ sender }: { sender: Sender }) {
  const account = sender.address
  const queryClient = useQueryClient()
  const [symbol, setSymbol] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const [dest, setDest] = useState<PayoutDest>('Arc')
  const [fastChoice, setFastChoice] = useState(true)
  const [recipientText, setRecipientText] = useState('')
  // What the last submit sent, read once its receipt is in.
  const sending = useRef<{ dest: PayoutDest; fast: boolean } | null>(null)
  const [sentText, setSentText] = useState('Your money was sent.')
  const tx = useTx(() => {
    setAmountText('')
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
    const sent = sending.current
    setSentText(
      sent && sent.dest !== 'Arc'
        ? `Sent from Arc. It arrives on ${CHAIN_LABELS[sent.dest]} in about ${sent.fast ? 'a minute' : '15 to 20 minutes'}.`
        : 'Your money was sent.',
    )
  })

  const balances = useQuery({
    queryKey: balancesKey(account),
    queryFn: () => fetchAccountBalances(arcClient, account),
    staleTime: 15_000,
  })
  const usdc = balances.data?.usdc
  const held = balances.data ? (symbol === 'USDC' ? balances.data.usdc : balances.data.eurc) : undefined
  // Arc gas is paid in USDC, so only USDC keeps the buffer back. EURC can all go, but needs USDC for the fee.
  const max = held === undefined ? undefined : symbol === 'USDC' ? maxAccountSend(held, PASSKEY_GAS_BUFFER) : held
  const noGas = usdc !== undefined && usdc < PASSKEY_GAS_BUFFER

  // CCTP only moves USDC, so EURC stays on Arc.
  const destinations: PayoutDest[] = symbol === 'USDC' ? ['Arc', ...CCTP_CHAINS.map((c) => c.key)] : ['Arc']
  const crossChain = dest !== 'Arc'
  const chain = crossChain ? chainByKey(dest) : null
  const fast = fastChoice && chain !== null && chain.fast

  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const overHeld = amount !== null && held !== undefined && amount > held
  const overMax = !overHeld && amount !== null && max !== undefined && amount > max

  const recipientRaw = recipientText.trim()
  const typed = recipientRaw === '' ? null : parseTypedAddress(recipientRaw)
  let recipientError: string | undefined
  if (typed && !typed.ok) recipientError = typed.error === 'typo' ? ADDRESS_TYPO : 'Enter a valid address (0x and 40 characters).'
  else if (typed?.ok && (isAddressEqual(typed.address, zeroAddress) || isAddressEqual(typed.address, account))) recipientError = OWN_ADDRESS
  const recipient: Address | null = typed?.ok && !recipientError ? typed.address : null

  const [quoteAmount, setQuoteAmount] = useState<bigint | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuoteAmount(amount), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [amount])
  const fee = useQuery({
    queryKey: ['account-send-fee', dest, fast, quoteAmount?.toString()],
    queryFn: () => fetchForwardFee(ARC_DOMAIN, destDomain(dest), quoteAmount!, fast),
    enabled: crossChain && quoteAmount !== null && quoteAmount > 0n,
    staleTime: 30_000,
    retry: 1,
  })
  const quote = crossChain && amount !== null && quoteAmount === amount ? fee.data : undefined
  const arrives = amount !== null && quote ? amount - quote.maxFee : null
  const tooSmall = arrives !== null && arrives <= 0n

  const canSubmit =
    amount !== null &&
    max !== undefined &&
    !overHeld &&
    !overMax &&
    !noGas &&
    recipient !== null &&
    !tx.locked &&
    (!crossChain || (quote !== undefined && !tooSmall))

  function chooseSymbol(next: TokenSymbol) {
    setSymbol(next)
    if (next !== 'USDC') setDest('Arc')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || amount === null || recipient === null || tx.locked) return
    sending.current = { dest, fast }
    void tx.run(
      sender,
      async () => {
        // A fresh quote at send time, so the fee cap matches what Circle charges now.
        const fresh = crossChain ? await fetchForwardFee(ARC_DOMAIN, destDomain(dest), amount, fast) : undefined
        if (fresh && quote && fresh.maxFee > quote.maxFee) {
          queryClient.setQueryData(['account-send-fee', dest, fast, amount.toString()], fresh)
          throw new PlainError(fresh.maxFee >= amount ? TOO_SMALL : FEE_CHANGED)
        }
        return buildAccountSendCalls({ token: TOKENS[symbol].address, amount, dest, recipient, maxFee: fresh?.maxFee, fast, account })
      },
      'Send money out',
    )
  }

  return (
    <section className="panel manage-section" aria-labelledby="send-out-heading">
      <h2 id="send-out-heading">Send money out</h2>
      <p className="hint">Send money from your Fundit account to any address you choose. You confirm with your passkey once.</p>
      <form className="create-form" onSubmit={submit} noValidate>
        <fieldset className="manage-fields" disabled={tx.locked}>
          <div className="form-field">
            <label htmlFor="send-out-token">Currency</label>
            <select id="send-out-token" className="select" value={symbol} onChange={(e) => chooseSymbol(e.target.value as TokenSymbol)}>
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="send-out-amount">Amount</label>
            <div className="link-row">
              <input
                id="send-out-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={(parsed && !parsed.ok) || overHeld || overMax ? true : undefined}
              />
              <button
                type="button"
                className="btn btn-outline"
                disabled={!max}
                onClick={() => max !== undefined && setAmountText(formatUnits(max, 6))}
              >
                Max
              </button>
            </div>
            <p className="hint">
              {held !== undefined
                ? `You have ${formatAmount(held, symbol)} in your Fundit account.`
                : balances.isError
                  ? 'Could not read your balance.'
                  : 'Reading your balance...'}
            </p>
            {parsed && !parsed.ok && (
              <p className="field-error" role="alert">
                {parsed.error}
              </p>
            )}
            {overHeld && (
              <p className="field-error" role="alert">
                That is more than your Fundit account holds.
              </p>
            )}
            {overMax && !noGas && (
              <p className="field-error" role="alert">
                Leave at least {formatAmount(PASSKEY_GAS_BUFFER, 'USDC')} in your Fundit account for the network fee.
              </p>
            )}
            {noGas && (
              <p className="field-error" role="alert">
                Add at least {formatAmount(PASSKEY_GAS_BUFFER, 'USDC')} to your Fundit account first. It pays the network fee.{' '}
                <Link to="/add-money">Add money</Link>
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="send-out-dest">Send to</label>
            <select id="send-out-dest" className="select" value={dest} onChange={(e) => setDest(e.target.value as PayoutDest)}>
              {destinations.map((d) => (
                <option key={d} value={d}>
                  {CHAIN_LABELS[d]}
                </option>
              ))}
            </select>
            {symbol === 'EURC' && <p className="hint">EURC can only be sent on Arc.</p>}
          </div>

          {chain && (
            <fieldset className="form-field">
              <legend>Speed</legend>
              {chain.fast && (
                <label className="choice">
                  <input type="radio" name="send-out-speed" checked={fast} onChange={() => setFastChoice(true)} />
                  <span>
                    Fast <span className="hint">About a minute. Costs a little more.</span>
                  </span>
                </label>
              )}
              <label className="choice">
                <input type="radio" name="send-out-speed" checked={!fast} onChange={() => setFastChoice(false)} />
                <span>
                  Standard <span className="hint">Can take 15 minutes or more.</span>
                </span>
              </label>
            </fieldset>
          )}

          <div className="form-field">
            <label htmlFor="send-out-recipient">Recipient</label>
            <input
              id="send-out-recipient"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x..."
              value={recipientText}
              onChange={(e) => setRecipientText(e.target.value)}
              aria-invalid={recipientError ? true : undefined}
            />
            <p className="hint">
              {crossChain ? `Make sure you control this address on ${CHAIN_LABELS[dest]}.` : 'The address that gets the money on Arc.'}
            </p>
            {recipientError && (
              <p className="field-error" role="alert">
                {recipientError}
              </p>
            )}
          </div>
        </fieldset>

        {crossChain && amount !== null && !overHeld && !overMax && (
          <dl className="donate-breakdown" aria-label="Breakdown">
            <div>
              <dt>Transfer fee (at most)</dt>
              <dd>{quote ? formatAmount(quote.maxFee, 'USDC') : fee.isError ? 'Not available' : 'Loading...'}</dd>
            </div>
            <div className="donate-total">
              <dt>Arrives on {CHAIN_LABELS[dest]}</dt>
              <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, 'USDC')}` : '-'}</dd>
            </div>
          </dl>
        )}
        {tooSmall && <p className="field-error">{TOO_SMALL}</p>}
        {crossChain && fee.isError && <p className="field-error">Could not get a fee quote from Circle. Try again in a moment.</p>}

        <TxStatus
          tx={tx}
          noun="transfer"
          successText={sentText}
          startOverWarning="The earlier transfer may still go through. If it does and you send again, the money goes out twice. Start over anyway?"
        />
        {tx.phase.kind !== 'timeout' && (
          <button type="submit" className="btn" disabled={!canSubmit}>
            {tx.busy ? 'Sending...' : 'Send'}
          </button>
        )}
      </form>
    </section>
  )
}
