import type { Hex } from 'viem'
import { ARC_CHAIN_ID, TX_TIMEOUT_MS } from '../config'
import { toBatch } from './batch'
import { CIRCLE_CODE, type ApprovalScreen, refreshEmailTokens, runChallenge } from './circleEmail'
import { arcClient } from './clients'
import { EmailError, type EmailSession, ucw } from './emailAccount'
import { PlainError } from './errors'
import { formatExact } from './format'
import { arcReceipts, type Sender, type SendOptions, waitForResult, withGasMargin } from './sender'

// The Worker's policy refused the request (worker/policy.ts): not one of Fundit's own contracts or calls.
export const NOT_AVAILABLE = 'This action is not available'
// The node already has a transaction with this nonce from the account. Nothing was sent.
export const NONCE_BUSY = 'Another transaction is still going through. Try again in a moment.'

// What Circle's window shows above the transaction: printable ASCII, at most 200 characters (the Worker's rule).
function memo(label: string): string | undefined {
  const text = label.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return text === '' ? undefined : text
}

// Arc pays gas in USDC with 18 decimals; Fundit shows 6.
const GAS_TO_USDC = 10n ** 12n

// What Circle's approval window shows. Without these fields it shows a generic title and an empty To and Total.
export function approvalScreen(opts: SendOptions | undefined, maxGasCost: bigint): ApprovalScreen {
  const fee = `Up to ${formatExact((maxGasCost + GAS_TO_USDC - 1n) / GAS_TO_USDC, 'USDC')}`
  const p = opts?.payment
  if (!p) {
    return { text: { title: opts?.label ?? 'Confirm', subtitle: 'Check the details, then confirm.', networkFeeLabel: 'Network fee', networkFee: fee } }
  }
  const amount = formatExact(p.amount, p.symbol)
  return {
    symbol: p.symbol,
    text: {
      title: opts.label,
      subtitle: 'Check the amount and who receives it, then confirm.',
      mainCurrency: { amount: amount.replace(/ \w+$/, ''), symbol: p.symbol },
      toLabel: 'To',
      to: [p.toName.length > 40 ? `${p.toName.slice(0, 39)}...` : p.toName, '', p.to],
      networkFeeLabel: 'Network fee',
      networkFee: fee,
      totalLabel: 'Total',
      total: [amount, ''],
      exchangeTotalValue: 'Plus the network fee',
    },
  }
}

// One sign request to the Worker. An expired user token (155104) is refreshed once through the Worker's cookies
// and the request sent again. A 401 (no Worker session, or a refused refresh) signs the account out (ucw).
async function requestSignature(walletId: string, transaction: string, note: string | undefined): Promise<string> {
  const ask = () => ucw<{ challengeId?: unknown }>('sign-transaction', { walletId, transaction, ...(note && { memo: note }) })
  let out: { challengeId?: unknown }
  try {
    try {
      out = await ask()
    } catch (err) {
      if (!(err instanceof EmailError && err.code === CIRCLE_CODE.userTokenExpired)) throw err
      await refreshEmailTokens()
      out = await ask()
    }
  } catch (err) {
    // The Worker's own refusal carries no Circle code.
    if (err instanceof EmailError && err.status === 403 && err.code === null) throw new PlainError(NOT_AVAILABLE)
    throw err
  }
  if (typeof out.challengeId !== 'string') throw new EmailError('Circle gave no challenge', 502, null)
  return out.challengeId
}

// viem wraps the node's text in its own errors, so every link of the cause chain is read.
function isNonceTooLow(err: unknown): boolean {
  let x = err
  for (let i = 0; x && typeof x === 'object' && i < 10; i++) {
    const { message, details, cause } = x as { message?: unknown; details?: unknown; cause?: unknown }
    if ([message, details].some((t) => typeof t === 'string' && /nonce too low/i.test(t))) return true
    x = cause
  }
  return false
}

// The sender for an email account (Circle user-controlled wallet, a plain EOA). Fundit builds the transaction,
// Circle signs it after the person approves in Circle's window, and Fundit broadcasts it at Arc's own fee.
// Several calls go out as one transaction through Multicall3From.
export function emailSender(s: EmailSession): Sender {
  return {
    kind: 'email',
    address: s.address,
    async send(calls, opts) {
      if (calls.length === 0) throw new Error('No calls to send')
      const call = toBatch(calls)
      // A revert in the estimate throws here, before Circle is asked for anything.
      const [nonce, gas, fees] = await Promise.all([
        arcClient.getTransactionCount({ address: s.address, blockTag: 'pending' }),
        arcClient.estimateGas({ account: s.address, to: call.to, data: call.data }),
        arcClient.estimateFeesPerGas(),
      ])
      // The shape signed on Arc testnet in Gate 1 (U11). The Worker refuses a type field, so Circle builds EIP-1559
      // from the fee fields. Numbers as decimal strings, chainId as a number.
      const transaction = JSON.stringify({
        chainId: ARC_CHAIN_ID,
        nonce: String(nonce),
        to: call.to,
        value: '0',
        data: call.data,
        gas: String(withGasMargin(gas)),
        maxFeePerGas: String(fees.maxFeePerGas),
        maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
      })
      const challengeId = await requestSignature(s.walletId, transaction, opts && memo(opts.label))
      const outcome = await runChallenge(challengeId, approvalScreen(opts, withGasMargin(gas) * fees.maxFeePerGas))
      if (outcome.kind === 'cancelled') return { status: 'rejected', completed: 0 }
      const signed = (outcome.data as { signedTransaction?: unknown } | undefined)?.signedTransaction
      if (typeof signed !== 'string' || signed === '') throw new EmailError('Circle gave no signed transaction', 502, null)
      let hash: Hex
      try {
        hash = await arcClient.sendRawTransaction({ serializedTransaction: (signed.startsWith('0x') ? signed : `0x${signed}`) as Hex })
      } catch (err) {
        if (isNonceTooLow(err)) throw new PlainError(NONCE_BUSY)
        throw err
      }
      opts?.onHash?.(hash, calls.length - 1)
      const result = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
      // One transaction: every call ran or none did.
      return result.status === 'success' ? result : { ...result, completed: 0 }
    },
  }
}
