import { useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Hex } from 'viem'
import { EXPLORER_URL, TX_TIMEOUT_MS } from '../config'
import { explainError, needsAddMoney, PlainError } from '../lib/errors'
import { arcReceipts, type Call, type Sender, type TxResult, waitForResult } from '../lib/sender'
import { ADD_MONEY_PATH } from '../lib/urls'
import { Button, StatusBox } from './ui'
import './Form.css'

export type TxPhase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'checking'; hash: Hex }
  | { kind: 'success'; hash: Hex }
  // The outcome is unknown. note explains a re-check that failed to answer. userop marks a passkey user
  // operation hash, which the explorer cannot show.
  | { kind: 'timeout'; hash: Hex; userop?: boolean; note?: string }
  // addMoney: the account is short of USDC for the network fee, so the box links to Add money.
  | { kind: 'error'; message: string; hash?: Hex; addMoney?: boolean }

export const PASSKEY_PROCESSING = 'Your passkey transaction is still processing.'
export const PASSKEY_LOGIN_TO_CHECK = 'Log in with your passkey to check this transaction.'

// The re-check for a timed-out result: a user operation hash goes back to the sender's bundler, a
// transaction hash to the Arc RPC. Neither sends anything.
export function recheckResult(sender: Sender | null, hash: Hex, userop: boolean): Promise<TxResult> {
  if (userop) {
    if (!sender?.recheck) return Promise.reject(new PlainError(PASSKEY_LOGIN_TO_CHECK))
    return sender.recheck(hash)
  }
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

// One action on Arc (a single call, or a passkey batch sent as one user operation), with the same
// no-double-send rules as donating: a send or check already running blocks another, and a timed-out
// transaction blocks a new one until a check settles it.
// onSuccess gets the hash of the mined transaction.
export function useTx(onSuccess: (hash: Hex) => void) {
  const [phase, setPhase] = useState<TxPhase>({ kind: 'idle' })
  // Set synchronously, so a second click before React re-renders cannot start a second send or check.
  const inFlight = useRef(false)
  // The sender of the last send, so a re-check of its timeout goes the same way.
  const lastSender = useRef<Sender | null>(null)

  function handle(res: TxResult) {
    switch (res.status) {
      case 'success':
        onSuccess(res.hash)
        setPhase({ kind: 'success', hash: res.hash })
        return
      case 'timeout':
        setPhase({ kind: 'timeout', hash: res.hash, userop: res.hashKind === 'userop' })
        return
      case 'reverted':
        setPhase({ kind: 'error', message: res.error, hash: res.hash })
        return
      case 'rejected':
        setPhase({ kind: 'error', message: 'You cancelled the request.' })
    }
  }

  // build runs inside the guard, so a quote it fetches or a check it makes cannot overlap a second click.
  // Several calls go to the sender in one send. A passkey sender makes them one user operation, so they
  // succeed or fail together. A wallet sender would send them one by one, so run refuses that.
  // usdcOut is the USDC the calls move out of the account; a passkey sender keeps the network fee on top.
  async function run(sender: Sender, build: () => Call | Call[] | Promise<Call | Call[]>, label: string, usdcOut?: bigint) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'sending' })
    lastSender.current = sender
    try {
      const built = await build()
      if (Array.isArray(built) && built.length > 1 && sender.kind !== 'passkey') {
        throw new Error('useTx: several calls need a passkey sender, which sends them as one user operation.')
      }
      handle(await sender.send(Array.isArray(built) ? built : [built], { label, usdcOut }))
    } catch (err) {
      setPhase({ kind: 'error', message: explainError(err), addMoney: needsAddMoney(err) })
    } finally {
      inFlight.current = false
    }
  }

  // Checks the same transaction again. It never sends a new one.
  async function checkAgain(hash: Hex, userop = false) {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ kind: 'checking', hash })
    try {
      handle(await recheckResult(lastSender.current, hash, userop))
    } catch (err) {
      setPhase({ kind: 'timeout', hash, userop, note: `We could not check it. ${explainError(err)}` })
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
  wallet = false,
}: {
  tx: ReturnType<typeof useTx>
  noun: string
  successText: string
  startOverWarning: string
  // A regular wallet sends this one (Add money). Every other send is from the Fundit account, with a passkey.
  wallet?: boolean
}) {
  const { phase } = tx
  // status-error stays on the error box: the e2e suite finds a failed send by it.
  return (
    <div className="tx-status form-status" aria-live="polite">
      {phase.kind === 'sending' && (
        <p>Confirm {wallet ? 'in your wallet' : 'with your passkey'}, then wait for the network. This can take a few seconds.</p>
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
          <p>{phase.userop ? PASSKEY_PROCESSING : <ExplorerLink hash={phase.hash} />}</p>
          {phase.note && <p className="form-error">{phase.note}</p>}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => tx.checkAgain(phase.hash, phase.userop)}>
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
