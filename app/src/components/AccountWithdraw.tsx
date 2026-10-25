import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { type Address, formatUnits, getAddress, isAddressEqual, zeroAddress } from 'viem'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, EOA_GAS_RESERVE, TOKENS, type TokenSymbol } from '../config'
import { buildAccountSendCalls, maxAccountSend, OWN_ADDRESS, TOO_SMALL } from '../lib/accountWithdraw'
import { chainByKey, pendingPayoutFrom, savePendingPayout, subscribePending } from '../lib/bridge'
import { arcClient } from '../lib/clients'
import { BALANCES_KEY, balancesKey, fetchAccountBalances } from '../lib/deposit'
import { confirmLine } from '../lib/account'
import { addAtLeast, PlainError } from '../lib/errors'
import { formatAmount, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { destDomain, type PayoutDest } from '../lib/payout'
import type { Sender } from '../lib/sender'
import { ADD_MONEY_PATH } from '../lib/urls'
import { ADDRESS_TYPO, parseTypedAddress } from '../lib/validate'
import { TxStatus, useTx } from './TxStatus'
import { AmountInput, Button, Field, Panel } from './ui'
import './Form.css'

const FEE_CHANGED = 'The transfer fee changed. Check the new amount and confirm again.'
const OVER_HELD = 'That is more than your Fundit account holds.'
// The reserve is what the account must keep for the network fee (EOA_GAS_RESERVE), shown as the real number.
const keepGas = (reserve: bigint) => `Leave at least ${formatAmount(reserve, 'USDC')} in your Fundit account for the network fee.`
const ONE_AT_A_TIME =
  'Your last transfer to another chain is still on its way. You can send another once it arrives. Follow it, or dismiss it if it takes much longer than expected, in the Account tab.'
// Transfers on their way are tracked in the Account tab on My page only. The form points there.
const QUOTE_DEBOUNCE_MS = 400

// Sends USDC or EURC out of a Fundit account, on Arc or as USDC to another chain. The organiser's payout form
// in Manage is the model: the same fee preview, a fresh quote at send time, and Fast as the default.
// Every kind of account: approve and burn go out as one transaction through Multicall3From, so a failed burn
// never leaves an open approval behind.
export function AccountWithdraw({ sender }: { sender: Sender }) {
  return <SendOutForm sender={sender} />
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
  // net is what arrives on the other chain, set once the fee is known at send time.
  const sending = useRef<{ dest: PayoutDest; fast: boolean; net?: bigint } | null>(null)
  const [sentText, setSentText] = useState('Your money was sent.')
  const tx = useTx((hash) => {
    setAmountText('')
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
    const sent = sending.current
    // The burn is on Arc. Saved so My page keeps tracking the mint after a reload. Arc sends need no record.
    if (sent && sent.dest !== 'Arc' && sent.net !== undefined) {
      // The store only keeps valid (checksummed) addresses.
      savePendingPayout({ campaign: getAddress(account), burnTx: hash, destDomain: destDomain(sent.dest), amount: formatUnits(sent.net, 6) })
    }
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
  // Arc gas is paid in USDC, so only USDC keeps the reserve back. EURC can all go, but needs USDC for the fee.
  const max = held === undefined ? undefined : symbol === 'USDC' ? maxAccountSend(held, EOA_GAS_RESERVE) : held
  const noGas = usdc !== undefined && usdc < EOA_GAS_RESERVE

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
  if (typed && !typed.ok) recipientError = typed.error === 'typo' ? ADDRESS_TYPO : 'Enter a valid address: 0x and 40 characters.'
  else if (typed?.ok && (isAddressEqual(typed.address, zeroAddress) || isAddressEqual(typed.address, account))) recipientError = OWN_ADDRESS
  const recipient: Address | null = typed?.ok && !recipientError ? typed.address : null

  // A send to another chain from this account that has not arrived. Another one waits until it does.
  const [inFlight, setInFlight] = useState(() => pendingPayoutFrom(account) !== null)
  useEffect(() => {
    const reload = () => setInFlight(pendingPayoutFrom(account) !== null)
    reload()
    return subscribePending(reload)
  }, [account])
  const blocked = crossChain && inFlight

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
    !blocked &&
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
        // The form's balance may be stale (another tab, a gift just sent), so check the amount on a fresh one.
        const now = await fetchAccountBalances(arcClient, account)
        queryClient.setQueryData(balancesKey(account), now)
        const nowHeld = symbol === 'USDC' ? now.usdc : now.eurc
        if (amount > nowHeld) throw new PlainError(OVER_HELD)
        // Read again here: another tab may have sent one since the form last looked.
        if (crossChain && pendingPayoutFrom(account)) throw new PlainError(ONE_AT_A_TIME)
        // A fresh quote at send time, so the fee cap matches what Circle charges now.
        const fresh = crossChain ? await fetchForwardFee(ARC_DOMAIN, destDomain(dest), amount, fast) : undefined
        if (fresh && quote && fresh.maxFee > quote.maxFee) {
          queryClient.setQueryData(['account-send-fee', dest, fast, amount.toString()], fresh)
          throw new PlainError(fresh.maxFee >= amount ? TOO_SMALL : FEE_CHANGED)
        }
        if (fresh) sending.current = { dest, fast, net: amount - fresh.maxFee }
        return buildAccountSendCalls({ token: TOKENS[symbol].address, amount, dest, recipient, maxFee: fresh?.maxFee, fast, account })
      },
      'Send money out',
      { amount, symbol, toName: dest === 'Arc' ? 'Address on Arc' : `Address on ${dest}`, to: recipient },
    )
  }

  return (
    <Panel
      title="Send money out"
      headingId="send-out-heading"
      description={`Send money from your Fundit account to any address you choose. ${confirmLine(sender.kind)} once.`}
    >
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="form-fields" disabled={tx.locked}>
          <Field label="Currency" id="send-out-token">
            <select className="select" value={symbol} onChange={(e) => chooseSymbol(e.target.value as TokenSymbol)}>
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
            </select>
          </Field>

          <div className="form-group">
            <div className="form-row">
              <Field label="Amount" id="send-out-amount">
                <AmountInput
                  id="send-out-amount"
                  currency={symbol}
                  placeholder="0"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  aria-invalid={(parsed && !parsed.ok) || overHeld || overMax ? true : undefined}
                />
              </Field>
              <Button variant="secondary" disabled={!max} onClick={() => max !== undefined && setAmountText(formatUnits(max, 6))}>
                Max
              </Button>
            </div>
            <p className="form-hint">
              {held !== undefined
                ? `You have ${formatAmount(held, symbol)} in your Fundit account.`
                : balances.isError
                  ? 'Could not read your balance. Check your connection.'
                  : 'Reading your balance...'}
            </p>
            {parsed && !parsed.ok && (
              <p className="form-error" role="alert">
                {parsed.error}
              </p>
            )}
            {overHeld && (
              <p className="form-error" role="alert">
                {OVER_HELD}
              </p>
            )}
            {overMax && !noGas && (
              <p className="form-error" role="alert">
                {keepGas(EOA_GAS_RESERVE)}
              </p>
            )}
            {noGas && (
              <p className="form-error" role="alert">
                {addAtLeast(EOA_GAS_RESERVE)}{' '}
                <Link to={ADD_MONEY_PATH}>Add money</Link>
              </p>
            )}
          </div>

          <Field label="Send to" id="send-out-dest" hint={symbol === 'EURC' ? 'EURC can only be sent on Arc. Choose Arc, or send USDC.' : undefined}>
            <select className="select" value={dest} onChange={(e) => setDest(e.target.value as PayoutDest)}>
              {destinations.map((d) => (
                <option key={d} value={d}>
                  {CHAIN_LABELS[d]}
                </option>
              ))}
            </select>
          </Field>

          {chain && (
            <fieldset className="form-group">
              <legend className="form-legend">Speed</legend>
              {chain.fast && (
                <label className="form-choice">
                  <input type="radio" name="send-out-speed" checked={fast} onChange={() => setFastChoice(true)} />
                  <span className="form-choice-text">
                    Fast <span className="form-hint">About a minute. Costs a little more.</span>
                  </span>
                </label>
              )}
              <label className="form-choice">
                <input type="radio" name="send-out-speed" checked={!fast} onChange={() => setFastChoice(false)} />
                <span className="form-choice-text">
                  Standard <span className="form-hint">Can take 15 minutes or more.</span>
                </span>
              </label>
            </fieldset>
          )}

          <Field
            label="Recipient"
            id="send-out-recipient"
            hint={crossChain ? `Make sure you control this address on ${CHAIN_LABELS[dest]}.` : 'The address that gets the money on Arc.'}
            error={recipientError}
            alert
          >
            <input
              autoComplete="off"
              spellCheck={false}
              placeholder="0x..."
              value={recipientText}
              onChange={(e) => setRecipientText(e.target.value)}
              aria-invalid={recipientError ? true : undefined}
            />
          </Field>
        </fieldset>

        {crossChain && amount !== null && !overHeld && !overMax && (
          <dl className="form-breakdown" aria-label="Breakdown">
            <div>
              <dt>Transfer fee (at most)</dt>
              <dd>{quote ? formatAmount(quote.maxFee, 'USDC') : fee.isError ? 'Not available' : 'Loading...'}</dd>
            </div>
            <div className="form-total">
              <dt>Arrives on {CHAIN_LABELS[dest]}</dt>
              <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, 'USDC')}` : '-'}</dd>
            </div>
          </dl>
        )}
        {tooSmall && <p className="form-error">{TOO_SMALL}</p>}
        {blocked && <p className="form-error">{ONE_AT_A_TIME}</p>}
        {crossChain && fee.isError && <p className="form-error">Could not get a fee quote from Circle. Try again in a moment.</p>}

        <TxStatus
          tx={tx}
          noun="transfer"
          successText={sentText}
          startOverWarning="The earlier transfer may still go through. If it does and you send again, the money goes out twice. Start over anyway?"
        />
        {tx.phase.kind !== 'timeout' && (
          <Button type="submit" block disabled={!canSubmit}>
            {tx.busy ? 'Sending...' : 'Send'}
          </Button>
        )}
      </form>
      {inFlight && <p className="form-hint">A transfer you sent to another chain is on its way. Follow it in the Account tab.</p>}
    </Panel>
  )
}
