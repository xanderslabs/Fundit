import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type EIP1193Provider, formatUnits, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { useConnection } from 'wagmi'
import { CHAIN_LABELS, TX_TIMEOUT_MS } from '../config'
import {
  ANOTHER_PENDING,
  blockingEntry,
  clearPendingUnified,
  notifyPending,
  type PendingUnified,
  pendingUnified,
  savePendingUnified,
  subscribePending,
} from '../lib/bridge'
import type { CampaignView } from '../lib/campaigns'
import { explainAfterApproval } from '../lib/errors'
import { bpsToPercent, formatExact, parseAmount } from '../lib/format'
import { arcReceipts, waitForResult } from '../lib/sender'
import {
  donateFromUnified,
  estimateReserves,
  explainUnifiedError,
  fetchGatewayTransfer,
  fetchUnifiedBalance,
  isSafeToRetry,
  maxSendable,
  pendingTransferId,
  planSpend,
  staticReserves,
} from '../lib/unified'

const EXPLORER_URL = arc.blockExplorers.default.url
const GATEWAY_DOCS = 'https://developers.circle.com/gateway'
const NO_REFERENCE_NOTE =
  "We have no reference from Circle to check this transfer. Look at the campaign's raised amount and your unified balance before you donate again."

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking' }
  | { kind: 'success'; hash: Hex; explorerUrl?: string }
  // Not known yet. hash is the Arc mint, when Circle reported one; transferId is Circle's transfer, when the
  // kit gave one. With neither there is nothing to check. Either way the money may still arrive, so this
  // phase blocks until a check settles it or the donor confirms Start over.
  | { kind: 'timeout'; amount: string; hash?: Hex; transferId?: string; note?: string }
  | { kind: 'error'; message: string }

function unifiedTimeout(saved: PendingUnified): Phase {
  return { kind: 'timeout', amount: saved.amount, hash: saved.hash, transferId: saved.transferId }
}

function chainName(chain: string): string {
  return CHAIN_LABELS[chain as keyof typeof CHAIN_LABELS] ?? chain
}

function ExplorerLink({ hash, url }: { hash: Hex; url?: string }) {
  const href = url?.startsWith('https://') ? url : `${EXPLORER_URL}/tx/${hash}`
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      View it on the Arc explorer
    </a>
  )
}

export function UnifiedDonate({ view, onBusyChange }: { view: CampaignView; onBusyChange?: (busy: boolean) => void }) {
  const { address: campaign, summary } = view
  const { isConnected, address, connector } = useConnection()
  const queryClient = useQueryClient()
  const [amountText, setAmountText] = useState('')
  // A spend started before a reload still blocks a new one until it is checked or the donor starts over.
  const [phase, setPhase] = useState<Phase>(() => {
    const saved = pendingUnified(campaign)
    return saved ? unifiedTimeout(saved) : { kind: 'idle' }
  })
  // A spend another tab saved for this campaign blocks this form too, unless this tab is mid-spend or checking.
  useEffect(
    () =>
      subscribePending(() => {
        const saved = pendingUnified(campaign)
        if (saved) setPhase((p) => (p.kind === 'idle' || p.kind === 'success' || p.kind === 'error' ? unifiedTimeout(saved) : p))
      }),
    [campaign],
  )
  // Set synchronously, so a second click before React re-renders cannot start a second spend or check.
  const inFlight = useRef(false)
  const wallet = isConnected && connector && address ? { connector, address } : null

  const balance = useQuery({
    queryKey: ['unified-balance', address?.toLowerCase()],
    queryFn: () => fetchUnifiedBalance(address!),
    enabled: wallet !== null && !summary.closed,
    staleTime: 30_000,
  })

  const amountEntered = amountText.trim() !== '' && parseAmount(amountText.trim()).ok
  // Circle's fee per chain, so the form knows the most it can send. Until the estimate answers, and for any
  // chain it cannot estimate, the static fee table stands in.
  const byChain = balance.data?.byChain
  const reserveQuery = useQuery({
    queryKey: ['unified-reserve', address?.toLowerCase(), byChain?.map((c) => `${c.chain}:${c.amount}`).join(',')],
    queryFn: async () =>
      estimateReserves({
        provider: (await wallet!.connector.getProvider()) as EIP1193Provider,
        campaign,
        account: wallet!.address,
        byChain: byChain!,
      }),
    // estimateSpend can make the wallet ask for account access, so it waits until the donor has opened this
    // option and typed an amount. Until then the static fee table sets the limit.
    enabled: wallet !== null && byChain !== undefined && byChain.length > 0 && !summary.closed && amountEntered,
    staleTime: 60_000,
  })
  const reserves = reserveQuery.data ?? (byChain ? staticReserves(byChain) : undefined)
  const sendable = byChain && reserves ? maxSendable(byChain, reserves) : undefined

  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const total = balance.data?.total
  const overBalance = amount !== null && sendable !== undefined && amount > sendable
  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  const locked = busy || phase.kind === 'timeout'
  const canSubmit = !summary.closed && wallet !== null && amount !== null && sendable !== undefined && !overBalance && !locked

  // The pay-with choice stays put while a spend may still be on its way.
  useEffect(() => {
    onBusyChange?.(locked)
  }, [locked, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['unified-balance'] })
  }

  // Circle reports the Arc mint. Success is shown only once the Arc RPC has the receipt.
  async function settle(hash: Hex, amountArg: string, explorerUrl?: string) {
    const res = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
    if (res.status === 'timeout') {
      savePendingUnified({ campaign, amount: amountArg, hash })
      setPhase({ kind: 'timeout', amount: amountArg, hash })
      return
    }
    clearPendingUnified(campaign)
    if (res.status === 'success') {
      refresh()
      setAmountText('')
      setPhase({ kind: 'success', hash, explorerUrl })
    } else if (res.status === 'reverted') {
      setPhase({ kind: 'error', message: res.error })
    } else {
      setPhase({ kind: 'error', message: 'You cancelled the request.' })
    }
  }

  async function donate() {
    if (inFlight.current || !canSubmit || !wallet || amount === null || !byChain || !reserves) return
    // Another tab may have started a donation to this campaign since this form loaded. Read the store again
    // before any marker is written or anything is signed.
    const fresh = blockingEntry(campaign)
    if (fresh) {
      setPhase(fresh.kind === 'unified' ? unifiedTimeout(fresh) : { kind: 'error', message: ANOTHER_PENDING })
      notifyPending()
      return
    }
    inFlight.current = true
    setPhase({ kind: 'sending' })
    const amountArg = formatUnits(amount, 6)
    try {
      const provider = (await wallet.connector.getProvider()) as EIP1193Provider
      // Planning only reads. Any failure here is before the signature, so the form opens again.
      let allocations
      try {
        ;({ allocations } = await planSpend({ provider, campaign, account: wallet.address, byChain, amount, reserves }))
      } catch (err) {
        setPhase({ kind: 'error', message: explainUnifiedError(err) ?? explainAfterApproval(err) })
        return
      }
      // Saved before the wallet is asked, so a reload during the spend still blocks a second one.
      savePendingUnified({ campaign, amount: amountArg })
      try {
        const { txHash, explorerUrl } = await donateFromUnified({
          provider,
          campaign,
          amount: amountArg,
          allocations: allocations.map((a) => ({ chain: a.chain, amount: formatUnits(a.amount, 6) })),
          account: wallet.address,
        })
        savePendingUnified({ campaign, amount: amountArg, hash: txHash })
        await settle(txHash, amountArg, explorerUrl)
      } catch (err) {
        if (isSafeToRetry(err)) {
          clearPendingUnified(campaign)
          setPhase({ kind: 'error', message: explainUnifiedError(err) ?? explainAfterApproval(err) })
        } else {
          // Circle may have accepted the transfer. Stay blocked until a check or a confirmed Start over.
          const transferId = pendingTransferId(err) ?? undefined
          savePendingUnified({ campaign, amount: amountArg, transferId })
          setPhase({ kind: 'timeout', amount: amountArg, transferId })
        }
      }
    } catch (err) {
      clearPendingUnified(campaign)
      setPhase({ kind: 'error', message: explainAfterApproval(err) })
    } finally {
      inFlight.current = false
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  // Checks the same transfer again. It never signs or sends anything new.
  async function checkAgain(p: { amount: string; hash?: Hex; transferId?: string }) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking' })
    try {
      if (p.hash) {
        await settle(p.hash, p.amount)
        return
      }
      const transfer = await fetchGatewayTransfer(p.transferId!)
      if (transfer.status === 'done') {
        savePendingUnified({ campaign, amount: p.amount, transferId: p.transferId, hash: transfer.txHash })
        await settle(transfer.txHash, p.amount)
      } else if (transfer.status === 'pending') {
        setPhase({ kind: 'timeout', ...p })
      } else {
        clearPendingUnified(campaign)
        setPhase({ kind: 'error', message: 'Circle could not finish this transfer. Check your unified balance before you try again.' })
      }
    } catch (err) {
      setPhase({ kind: 'timeout', ...p, note: `We could not check it. ${explainAfterApproval(err)}` })
    } finally {
      inFlight.current = false
    }
  }

  function startOver() {
    const ok = window.confirm(
      'The earlier transfer may still go through. If it does and you donate again, you will give twice. Start a new donation anyway?',
    )
    if (!ok) return
    clearPendingUnified(campaign)
    setAmountText('')
    setPhase({ kind: 'idle' })
  }

  return (
    <form className="donate-form" onSubmit={submit} noValidate>
      <p className="hint">
        A unified balance is USDC you have deposited with Circle Gateway, which you can spend on any supported chain
        without bridging first.
      </p>

      <div className="donate-status">
        {balance.isError && <p className="field-error">Could not read your unified balance. Try again in a moment.</p>}
        {balance.isPending && wallet && !summary.closed && <p className="hint">Reading your unified balance...</p>}
        {total !== undefined &&
          (total === 0n ? (
            <p>
              <strong>No unified balance yet.</strong>{' '}
              <a href={GATEWAY_DOCS} target="_blank" rel="noopener noreferrer">
                Learn how Circle Gateway works
              </a>
            </p>
          ) : (
            <p>
              Your unified balance: <strong>{formatExact(total, 'USDC')}</strong>
              {balance.data!.byChain.length > 0 && (
                <span className="hint"> (on {balance.data!.byChain.map((c) => chainName(c.chain)).join(', ')})</span>
              )}
            </p>
          ))}
      </div>

      <fieldset className="donate-fields" disabled={summary.closed || locked || total === undefined || total === 0n}>
        <div className="form-field">
          <label htmlFor="unified-amount">Amount</label>
          <div className="donate-amount">
            <input
              id="unified-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="25"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={(parsed && !parsed.ok) || overBalance ? true : undefined}
            />
            <span className="donate-symbol">USDC</span>
          </div>
          {parsed && !parsed.ok && (
            <p className="field-error" role="alert">
              {parsed.error}
            </p>
          )}
          {overBalance && (
            <p className="field-error" role="alert">
              This is more than can be sent from your unified balance after Circle's fees.
            </p>
          )}
          {sendable !== undefined && total !== undefined && total > 0n && (
            <p className="hint">
              Up to {formatExact(sendable, 'USDC')} can be sent after fees
              {reserveQuery.isFetching ? " (checking Circle's fees...)" : '.'}
            </p>
          )}
        </div>
      </fieldset>

      <p className="hint">
        The campaign gets the full amount. Circle's fees come out of your unified balance on top of it, so keep a little
        extra. Fundit's platform fee ({bpsToPercent(summary.donationFeeBps)}) applies once the donation is counted.
      </p>
      <p className="hint">
        Tips and messages work only when you pay on Arc. The donation counts toward the total as soon as it arrives,
        and shows in the activity list once someone counts it there.
      </p>

      <div className="donate-status" aria-live="polite">
        {phase.kind === 'sending' && (
          <p>Sign once in your wallet. Circle then sends the USDC to the campaign on Arc. This can take a few minutes.</p>
        )}
        {phase.kind === 'checking' && <p>Checking the transfer again...</p>}
        {phase.kind === 'success' && (
          <div className="status-box status-success">
            <p>
              <strong>Thank you. Your donation reached the campaign.</strong>
            </p>
            <p>
              <ExplorerLink hash={phase.hash} url={phase.explorerUrl} />
            </p>
          </div>
        )}
        {phase.kind === 'timeout' && (
          <div className="status-box">
            <p>
              <strong>Your unified balance donation is not confirmed yet.</strong> It may still go through. Check it before you try again,
              so you do not give twice.
            </p>
            {phase.hash && (
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
            )}
            {!phase.hash && !phase.transferId && <p>{NO_REFERENCE_NOTE}</p>}
            {phase.note && <p className="field-error">{phase.note}</p>}
            <div className="donate-actions">
              {(phase.hash || phase.transferId) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => checkAgain({ amount: phase.amount, hash: phase.hash, transferId: phase.transferId })}
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
        {phase.kind === 'error' && (
          <div className="status-box status-error">
            <p>{phase.message}</p>
          </div>
        )}
      </div>

      {phase.kind === 'timeout' ? null : (
        <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
          {busy ? 'Donating...' : 'Donate'}
        </button>
      )}
    </form>
  )
}
