import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Hex } from 'viem'
import { EXPLORER_URL, TX_TIMEOUT_MS } from '../config'
import { type AccountKind, confirmLine } from '../lib/account'
import { CANCELLED, CHECK_FAILED, explainError, needsAddMoney } from '../lib/errors'
import { arcReceipts, type Call, type PaymentReview, type Sender, type TxResult, waitForResult } from '../lib/sender'
import { ADD_MONEY_PATH } from '../lib/urls'
import { Button, StatusBox } from './ui'
import './Form.css'

export type TxPhase =
  | { kind: 'idle' }
  // by: the kind of sender, so the line under the button names the prompt that follows.
  | { kind: 'sending'; by: AccountKind }
  | { kind: 'checking'; hash: Hex }
  | { kind: 'success'; hash: Hex }
  // The outcome is unknown. note explains a re-check that failed to answer.
  | { kind: 'timeout'; hash: Hex; note?: string }
  // addMoney: the account is short of USDC for the network fee, so the box links to Add money.
  | { kind: 'error'; message: string; hash?: Hex; addMoney?: boolean }

// The re-check for a timed-out result: the transaction hash goes to the Arc RPC. It sends nothing.
export function recheckResult(hash: Hex): Promise<TxResult> {
  return waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
}

export function AddMoneyLink() {
  return <Link to={ADD_MONEY_PATH}>Add money</Link>
}

export function ExplorerLink({ hash }: { hash: Hex }) {
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      View it on the Arc explorer
    </a>
  )
}

// One action on Arc (a single call, or a batch sent as one transaction), with the same
// no-double-send rules as donating: a send or check already running blocks another, and a timed-out
// transaction blocks a new one until a check settles it.
// onSuccess gets the hash of the mined transaction.
export function useTx(onSuccess: (hash: Hex) => void) {
  const [phase, setPhase] = useState<TxPhase>({ kind: 'idle' })
  // Set synchronously, so a second click before React re-renders cannot start a second send or check.
  const inFlight = useRef(false)

  function handle(res: TxResult) {
    switch (res.status) {
      case 'success':
        onSuccess(res.hash)
        setPhase({ kind: 'success', hash: res.hash })
        return
      case 'timeout':
        setPhase({ kind: 'timeout', hash: res.hash })
        return
      case 'reverted':
        setPhase({ kind: 'error', message: res.error, hash: res.hash })
        return
      case 'rejected':
        setPhase({ kind: 'error', message: CANCELLED })
    }
  }

  // build runs inside the guard, so a quote it fetches or a check it makes cannot overlap a second click.
  // Several calls go to the sender in one send. Every sender makes them one transaction through
  // Multicall3From, so they succeed or fail together.
  async function run(sender: Sender, build: () => Call | Call[] | Promise<Call | Call[]>, label: string, payment?: PaymentReview) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'sending', by: sender.kind })
    try {
      const built = await build()
      handle(await sender.send(Array.isArray(built) ? built : [built], { label, payment }))
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err), addMoney: needsAddMoney(err) })
    } finally {
      inFlight.current = false
    }
  }

  // Checks the same transaction again. It never sends a new one.
  async function checkAgain(hash: Hex) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking', hash })
    try {
      handle(await recheckResult(hash))
    } catch (err) {
      console.error(err)
      setPhase({ kind: 'timeout', hash, note: CHECK_FAILED })
    } finally {
      inFlight.current = false
    }
  }

  function startOver(warning: string) {
    if (!window.confirm(warning)) return
    setPhase({ kind: 'idle' })
  }

  const busy = phase.kind === 'sending' || phase.kind === 'checking'
  return { phase, run, checkAgain, startOver, busy, locked: busy || phase.kind === 'timeout' }
}

export function TxStatus({
  tx,
  noun,
  successText,
  startOverWarning,
}: {
  tx: ReturnType<typeof useTx>
  noun: string
  successText: string
  startOverWarning: string
}) {
  const { phase } = tx
  // status-error stays on the error box: the e2e suite finds a failed send by it.
  return (
    <div className="tx-status form-status" aria-live="polite">
      {phase.kind === 'sending' && (
        <p>{confirmLine(phase.by)}, then wait for the network. This can take a few seconds.</p>
      )}
      {phase.kind === 'checking' && <p>Checking the transaction again...</p>}
      {phase.kind === 'success' && (
        <StatusBox tone="success">
          <p>
            <strong>{successText}</strong>
          </p>
          <p>
            <ExplorerLink hash={phase.hash} />
          </p>
        </StatusBox>
      )}
      {phase.kind === 'timeout' && (
        <StatusBox>
          <p>
            <strong>Your {noun} is not confirmed yet.</strong> It may still go through. Check it before you try again.
          </p>
          <p>
            <ExplorerLink hash={phase.hash} />
          </p>
          {phase.note && <p className="form-error">{phase.note}</p>}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => tx.checkAgain(phase.hash)}>
              Check again
            </Button>
            <Button variant="secondary" onClick={() => tx.startOver(startOverWarning)}>
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
  )
}
