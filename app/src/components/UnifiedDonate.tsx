import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type EIP1193Provider, formatUnits, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { useConnection } from 'wagmi'
import { CHAIN_LABELS, TX_TIMEOUT_MS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import { explainError } from '../lib/errors'
import { bpsToPercent, formatAmount, parseAmount } from '../lib/format'
import { arcReceipts, waitForResult } from '../lib/sender'
import {
  donateFromUnified,
  explainUnifiedError,
  fetchGatewayTransfer,
  fetchUnifiedBalance,
  pendingTransferId,
  pickAllocations,
} from '../lib/unified'

const EXPLORER_URL = arc.blockExplorers.default.url
const GATEWAY_DOCS = 'https://developers.circle.com/gateway'

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking' }
  | { kind: 'success'; hash: Hex; explorerUrl?: string }
  // Not known yet. hash is the Arc mint, when Circle reported one; transferId is Circle's transfer, when the
  // kit stopped waiting before the mint. Either way the money may still arrive, so this phase blocks.
  | { kind: 'timeout'; hash?: Hex; transferId?: string; note?: string }
  | { kind: 'error'; message: string }

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
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Set synchronously, so a second click before React re-renders cannot start a second spend or check.
  const inFlight = useRef(false)
  const wallet = isConnected && connector && address ? { connector, address } : null

  const balance = useQuery({
    queryKey: ['unified-balance', address?.toLowerCase()],
    queryFn: () => fetchUnifiedBalance(address!),
    enabled: wallet !== null && !summary.closed,
    staleTime: 30_000,
  })

  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const total = balance.data?.total
  const overBalance = amount !== null && total !== undefined && amount > total
  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  const locked = busy || phase.kind === 'timeout'
  const canSubmit = !summary.closed && wallet !== null && amount !== null && total !== undefined && !overBalance && !locked

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
  async function settle(hash: Hex, explorerUrl?: string) {
    const res = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
    if (res.status === 'success') {
      refresh()
      setAmountText('')
      setPhase({ kind: 'success', hash, explorerUrl })
    } else if (res.status === 'timeout') {
      setPhase({ kind: 'timeout', hash })
    } else if (res.status === 'reverted') {
      setPhase({ kind: 'error', message: res.error })
    } else {
      setPhase({ kind: 'error', message: 'You cancelled the request.' })
    }
  }

  async function donate() {
    if (inFlight.current || !canSubmit || !wallet || amount === null || !balance.data) return
    inFlight.current = true
    setPhase({ kind: 'sending' })
    try {
      const picked = pickAllocations(balance.data.byChain, amount)
      const provider = (await wallet.connector.getProvider()) as EIP1193Provider
      const { txHash, explorerUrl } = await donateFromUnified({
        provider,
        campaign,
        amount: formatUnits(amount, 6),
        allocations: picked.map((a) => ({ chain: a.chain, amount: formatUnits(a.amount, 6) })),
        account: wallet.address,
      })
      await settle(txHash, explorerUrl)
    } catch (err) {
      const transferId = pendingTransferId(err)
      if (transferId) setPhase({ kind: 'timeout', transferId })
      else setPhase({ kind: 'error', message: explainUnifiedError(err) ?? explainError(err) })
    } finally {
      inFlight.current = false
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  // Checks the same transfer again. It never signs or sends anything new.
  async function checkAgain(p: { hash?: Hex; transferId?: string }) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking' })
    try {
      if (p.hash) {
        await settle(p.hash)
        return
      }
      const transfer = await fetchGatewayTransfer(p.transferId!)
      if (transfer.status === 'done') await settle(transfer.txHash)
      else if (transfer.status === 'pending') setPhase({ kind: 'timeout', ...p })
      else setPhase({ kind: 'error', message: 'Circle could not finish this transfer. Check your unified balance before you try again.' })
    } catch (err) {
      setPhase({ kind: 'timeout', ...p, note: `We could not check it. ${explainError(err)}` })
    } finally {
      inFlight.current = false
    }
  }

  function startOver() {
    const ok = window.confirm(
      'The earlier transfer may still go through. If it does and you donate again, you will give twice. Start a new donation anyway?',
    )
    if (!ok) return
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
              Your unified balance: <strong>{formatAmount(total, 'USDC')}</strong>
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
              This is more than your unified balance.
            </p>
          )}
        </div>
      </fieldset>

      <p className="hint">
        The campaign gets the full amount. Circle's fees come out of your unified balance on top of it, so keep a little
        extra. Fundit's platform fee ({bpsToPercent(summary.donationFeeBps)}) applies once the donation is counted.
      </p>
      <p className="hint">
        Tips and messages work only when you pay on Arc. This donation shows in the activity list as a cross-chain
        donation.
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
              <strong>Your donation is not confirmed yet.</strong> It may still go through. Check it before you try again,
              so you do not give twice.
            </p>
            {phase.hash && (
              <p>
                <ExplorerLink hash={phase.hash} />
              </p>
            )}
            {phase.note && <p className="field-error">{phase.note}</p>}
            <div className="donate-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => checkAgain({ hash: phase.hash, transferId: phase.transferId })}
              >
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
