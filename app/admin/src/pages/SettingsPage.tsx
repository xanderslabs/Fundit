import { useQueryClient } from '@tanstack/react-query'
import { getAccount, simulateContract, switchChain, waitForTransactionReceipt, watchAccount, writeContract } from '@wagmi/core'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type Address as EvmAddress, isAddressEqual, zeroAddress } from 'viem'
import { factoryAbi } from '../../../src/abi/factory'
import { ConnectWallet } from '../../../src/components/ConnectWallet'
import { Actions, Badge, Banner, Button, Dialog, Field } from '../../../src/components/ui'
import { NETWORKS } from '../../../src/config'
import { CANCELLED, explainError, isUserRejection, revertText } from '../../../src/lib/errors'
import { shortAddress } from '../../../src/lib/names'
import { type AdminSession, matchesWorker } from '../lib/api'
import { readClient } from '../lib/clients'
import { confirmKind, flow, type FlowEvent, type FlowState, IDLE, inFlight, typedConfirmOk } from '../lib/controlFlow'
import type { FactoryState } from '../lib/factoryState'
import type { ScanEvent } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { buildCall, canAct, checkFeatured, checkFees, checkTreasury, describe, type OwnerAction } from '../lib/ownerActions'
import { factoryKey, STALE_AFTER_MS, useFactory, useSnapshot } from '../lib/queries'
import { useScan } from '../scan/ScanProvider'
import { Address } from '../ui/Address'
import { Card } from '../ui/Card'
import { usePanel } from '../ui/Shell'
import { TxStatus } from '../ui/TxStatus'
import { adminWagmiConfig } from '../wagmi'

const MAINNET_GAS = 'Mainnet: this uses real USDC for gas'
const TYPED_PROMPT = 'Type the last 4 characters of the new address to confirm.'

type Account = { address?: EvmAddress; chainId?: number }
type Group = 'featured' | 'fees' | 'pause' | 'treasury'

function groupOf(action: OwnerAction | undefined): Group | null {
  if (!action) return null
  switch (action.kind) {
    case 'setFeatured':
      return 'featured'
    case 'setFees':
      return 'fees'
    case 'setTreasury':
      return 'treasury'
    default:
      return 'pause'
  }
}

// 250 bps is "2.5% (250 bps)".
function fee(bps: number): string {
  return `${bps / 100}% (${bps} bps)`
}

function dialogTitle(action: OwnerAction, network: AdminNetwork): string {
  const on = `on ${ADMIN_NETWORKS[network].label}`
  switch (action.kind) {
    case 'setFees':
      return `Change fees ${on}`
    case 'setTreasury':
      return `Change the treasury ${on}`
    case 'pauseCreation':
      return `Pause new Fundits ${on}`
    case 'unpauseCreation':
      return `Unpause new Fundits ${on}`
    case 'setFeatured':
      return `Change the featured Fundit ${on}`
  }
}

// The domains the factory accepts for EURC payouts. They are fixed at deploy and have no getter, so they come from
// the EurcPayoutDomainSet events the history scan reads from the deploy block. null until the scan has them.
function eurcDomains(events: ScanEvent[] | undefined, network: AdminNetwork): string | null {
  if (!events) return null
  const { cctpChains, chainLabels } = NETWORKS[network]
  const names = events
    .filter((e) => e.kind === 'EurcPayoutDomainSet')
    .map((e) => {
      const domain = Number(e.args.domain)
      const chain = cctpChains.find((c) => c.domain === domain)
      return chain ? `${chainLabels[chain.key]} (domain ${domain})` : `Domain ${domain}`
    })
  return names.length ? names.join(', ') : null
}

// The page's change in progress, with the reducer as the one source of truth. send applies an event; step does too,
// but returns null when the reducer made no transition, so an async continuation only goes on when its own event
// moved the flow. current is the live state, for checking that a continuation still owns it.
function useFlow() {
  const [state, setState] = useState<FlowState>(IDLE)
  const current = useRef(state)
  function send(event: FlowEvent): FlowState {
    const next = flow(current.current, event)
    current.current = next
    setState(next)
    return next
  }
  function step(event: FlowEvent): FlowState | null {
    const prev = current.current
    const next = send(event)
    return next === prev ? null : next
  }
  return { state, current, send, step }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-row">
      <dt className="admin-row-label">{label}</dt>
      <dd className="admin-row-value">{children}</dd>
    </div>
  )
}

export function SettingsPage() {
  const { session, network } = usePanel()
  const factory = useFactory(session, network)

  if (!matchesWorker(session, network)) return <p className="admin-error">This panel was built for another network.</p>

  const state = factory.data
  return (
    <div className="admin-page">
      <CurrentSettings network={network} factory={factory} />
      {state ? (
        <Controls session={session} network={network} state={state} />
      ) : (
        <>
          <Card title="Controls" state={factory.isError ? 'error' : 'loading'} onRetry={() => void factory.refetch()} />
          <div className="admin-danger">
            <Card title="Danger zone" state={factory.isError ? 'error' : 'loading'} onRetry={() => void factory.refetch()} />
          </div>
        </>
      )}
    </div>
  )
}

function CurrentSettings({ network, factory }: { network: AdminNetwork; factory: ReturnType<typeof useFactory> }) {
  const { session } = usePanel()
  const snapshot = useSnapshot(session, network)
  const scan = useScan()
  const s = factory.data
  const featured = s && !isAddressEqual(s.featured, zeroAddress) ? s.featured : null
  const featuredTitle = featured ? snapshot.data?.find((r) => isAddressEqual(r.address, featured))?.title : undefined
  const domains = eurcDomains(scan.state?.events, network)

  return (
    <Card
      title="Current settings"
      state={s ? 'ready' : factory.isError ? 'error' : 'loading'}
      updatedAt={factory.dataUpdatedAt || undefined}
      staleAfterMs={STALE_AFTER_MS}
      onRefresh={() => void factory.refetch()}
      onRetry={() => void factory.refetch()}
      source="Read from the factory contract."
    >
      {s && (
        <dl className="admin-details">
          <Row label="Donation fee">{fee(s.donationFeeBps)}</Row>
          <Row label="Withdrawal fee">{fee(s.withdrawFeeBps)}</Row>
          <Row label="Treasury">
            <Address address={s.treasury} network={network} label="treasury" />
          </Row>
          <Row label="Featured Fundit">
            {featured ? (
              <span className="admin-settings-featured">
                {featuredTitle && <span>{featuredTitle}</span>}
                <Address address={featured} network={network} label="featured Fundit" />
              </span>
            ) : (
              <span className="admin-muted">None</span>
            )}
          </Row>
          <Row label="New Fundits">{s.paused ? <Badge tone="attention">Paused</Badge> : <Badge tone="success">Open</Badge>}</Row>
          <Row label="EURC payout domain">
            {domains ?? <span className="admin-muted">{scan.state ? 'None found yet' : 'Reading history'}</span>}
          </Row>
        </dl>
      )}
    </Card>
  )
}

function Controls({ session, network, state }: { session: AdminSession; network: AdminNetwork; state: FactoryState }) {
  const { factory: factoryAddress, chainId, label } = ADMIN_NETWORKS[network]
  const queryClient = useQueryClient()
  const snapshot = useSnapshot(session, network)
  const scan = useScan()
  const { state: tx, current, send, step } = useFlow()

  const [account, setAccount] = useState<Account>(() => getAccount(adminWagmiConfig))
  useEffect(() => watchAccount(adminWagmiConfig, { onChange: setAccount }), [])

  // null until the owner edits; until then the fields show the factory's current values, even after a refetch.
  const [donation, setDonation] = useState<string | null>(null)
  const [withdraw, setWithdraw] = useState<string | null>(null)
  const [treasury, setTreasury] = useState('')
  const [treasuryAgain, setTreasuryAgain] = useState('')
  const [pickedFeatured, setFeatured] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // A refusal before the flow starts (a form check or the wrong wallet), shown under its control.
  const [note, setNote] = useState<{ group: Group; text: string } | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  // One review or signature at a time. The ref closes the gap before React re-renders (a double click); checking
  // disables every Review button while a form check waits on the RPC, before the flow has left edit.
  const lock = useRef(false)
  const [checking, setChecking] = useState(false)

  // A change still in flight when the page goes away (network switch, sign out) stops at its next step.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const currentFeatured = isAddressEqual(state.featured, zeroAddress) ? '' : state.featured
  const featured = pickedFeatured ?? currentFeatured
  const donationValue = donation ?? String(state.donationFeeBps)
  const withdrawValue = withdraw ?? String(state.withdrawFeeBps)
  const can = canAct(account.address, account.chainId, session.address, state, network)
  const busy = inFlight(tx.step)
  const disabled = busy || checking || (!can.ok && can.fix === 'connect')

  const isCampaign = (a: EvmAddress) => readClient(network).readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'isCampaign', args: [a] })

  function switchFailed(e: unknown): string {
    return isUserRejection(e) ? `Your wallet did not switch to ${label}. Approve the switch to make this change.` : explainError(e)
  }

  async function switchNow() {
    setSwitchError(null)
    try {
      await switchChain(adminWagmiConfig, { chainId })
    } catch (e) {
      setSwitchError(switchFailed(e))
    }
  }

  // Runs one review or signature with the lock held. A click while another is under way does nothing.
  async function exclusive(task: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setChecking(true)
    try {
      await task()
    } finally {
      lock.current = false
      setChecking(false)
    }
  }

  // Review: the form check, the owner wallet, then the chain switch if needed, then the simulation. Featured goes on
  // to the signature; every other change stops at the confirm dialog. Each step goes on only when its own event
  // moved the flow.
  function review(group: Group, check: () => Promise<OwnerAction | { refused: string }>) {
    return exclusive(async () => {
      setNote(null)
      setTyped('')
      const action = await check()
      if (!alive.current) return
      if ('refused' in action) return setNote({ group, text: action.refused })
      const live = getAccount(adminWagmiConfig)
      const ok = canAct(live.address, live.chainId, session.address, state, network)
      if (!ok.ok && ok.fix === 'connect') return setNote({ group, text: ok.reason })
      let s = step({ type: 'review', action, network, walletChainId: live.chainId })
      if (!s) return
      if (s.step === 'switchChain') {
        try {
          await switchChain(adminWagmiConfig, { chainId })
        } catch (e) {
          step({ type: 'failed', error: switchFailed(e) })
          return
        }
        if (!alive.current) return
        s = step({ type: 'switched' })
        if (!s) return
      }
      if (s.step !== 'simulating') return
      try {
        const { request } = await simulateContract(adminWagmiConfig, { ...buildCall(action, network), account: live.address } as never)
        if (!alive.current) return
        s = step({ type: 'simulated', action, request })
      } catch (e) {
        step({ type: 'simulateFailed', action, error: revertText(e) ?? explainError(e) })
        return
      }
      if (s?.step === 'waitingWallet') await write(s)
    })
  }

  function confirmAndSign() {
    return exclusive(async () => {
      const s = step({ type: 'sign', typed })
      if (s?.step === 'waitingWallet') await write(s)
    })
  }

  // Signs exactly the request the simulation returned for the action under review, then waits for the receipt. s
  // must still be the live state: the confirm dialog showed s.action, and the reducer stored s.request with it.
  async function write(s: FlowState) {
    if (s.step !== 'waitingWallet' || s !== current.current || !s.action || s.request === undefined || !alive.current) return
    // The wallet may have moved since the simulation.
    const live = getAccount(adminWagmiConfig)
    const ok = canAct(live.address, live.chainId, session.address, state, network)
    if (!ok.ok) return void step({ type: 'failed', error: ok.reason })
    let hash: `0x${string}`
    try {
      hash = await writeContract(adminWagmiConfig, s.request as never)
    } catch (e) {
      step({ type: 'failed', error: isUserRejection(e) ? CANCELLED : (revertText(e) ?? explainError(e)) })
      return
    }
    step({ type: 'sent', hash })
    try {
      const receipt = await waitForTransactionReceipt(adminWagmiConfig, { hash, chainId })
      if (receipt.status === 'success') step({ type: 'confirmed' })
      else step({ type: 'failed', error: 'The transaction was mined but failed. Nothing changed.' })
    } catch {
      // It was sent and may still land: trying again could make the change twice.
      step({ type: 'failed', error: "Couldn't confirm it yet. Check the transaction on the explorer before you try again." })
    }
    // Read again whatever happened: a change that was sent may have landed.
    await queryClient.invalidateQueries({ queryKey: factoryKey(network) })
    scan.nudge()
  }

  function reviewFees() {
    return review('fees', async () => {
      const r = checkFees(donationValue, withdrawValue)
      if (!r.ok) return { refused: r.reason }
      if (r.donationBps === state.donationFeeBps && r.withdrawBps === state.withdrawFeeBps) return { refused: 'Those are the current fees. Change one to review.' }
      return { kind: 'setFees', donationBps: r.donationBps, withdrawBps: r.withdrawBps }
    })
  }

  function reviewTreasury() {
    return review('treasury', async () => {
      const r = await checkTreasury(treasury, treasuryAgain, factoryAddress, isCampaign).catch(() => null)
      return !r ? { refused: 'We could not check that address. Try again.' } : r.ok ? { kind: 'setTreasury', treasury: r.address } : { refused: r.reason }
    })
  }

  function reviewFeatured() {
    return review('featured', async () => {
      const r = await checkFeatured(featured, isCampaign).catch(() => null)
      return !r ? { refused: 'We could not check that address. Try again.' } : r.ok ? { kind: 'setFeatured', campaign: r.campaign } : { refused: r.reason }
    })
  }

  // What shows under one control: its refusal, the flow's error, and the transaction status.
  function feedback(group: Group) {
    const mine = groupOf(tx.action) === group
    const flowError = mine && (tx.step === 'edit' || tx.step === 'simulateFailed') ? tx.error : undefined
    const text = note?.group === group ? note.text : flowError
    return (
      <>
        {text && (
          <p className="admin-control-error" role="alert">
            {text}
          </p>
        )}
        {mine && tx.step === 'switchChain' && <p className="admin-note">Switch to {label} in your wallet.</p>}
        {mine && tx.step === 'simulating' && <p className="admin-note">Checking the change...</p>}
        {mine && <TxStatus step={tx.step} hash={tx.hash} network={network} error={tx.error} />}
      </>
    )
  }

  const reviewing = (group: Group) => groupOf(tx.action) === group && (tx.step === 'switchChain' || tx.step === 'simulating')
  const pending = tx.step === 'confirm' && tx.action ? tx.action : null
  const shown = pending ? describe(pending, state) : null
  const typedOk = pending?.kind === 'setTreasury' ? typedConfirmOk(typed, pending.treasury) : true
  const featuredRows = snapshot.data ?? []

  return (
    <>
      <Card title="Controls" state="ready" source="Each change is checked against the contract, then signed by the owner wallet.">
        <div className="admin-settings-body">
          {!can.ok && (
            <Banner tone="attention" action={can.fix === 'switch' ? <Button variant="secondary" onClick={() => void switchNow()}>{`Switch to ${label}`}</Button> : undefined}>
              <p>{can.reason}</p>
              {switchError && <p className="admin-control-error">{switchError}</p>}
              {can.fix === 'connect' && <ConnectWallet config={adminWagmiConfig} onConnected={() => {}} />}
            </Banner>
          )}

          <section className="admin-control" aria-label="Featured Fundit">
            <h3 className="admin-control-title">Featured Fundit</h3>
            <fieldset className="admin-picker">
              <legend className="admin-note">Pick the Fundit to feature</legend>
              <div className="admin-picker-list">
                <label className="admin-pick">
                  <input type="radio" name="featured" checked={featured === ''} onChange={() => setFeatured('')} />
                  <span>None (clear the featured Fundit)</span>
                  {currentFeatured === '' && <Badge>Current</Badge>}
                </label>
                {featuredRows.map((r) => (
                  <label key={r.address} className="admin-pick">
                    <input type="radio" name="featured" checked={featured.toLowerCase() === r.address.toLowerCase()} onChange={() => setFeatured(r.address)} />
                    <span className="admin-pick-title">{r.title || 'Untitled'}</span>
                    <code className="admin-pick-address">{shortAddress(r.address)}</code>
                    {r.isTest && <Badge>Test</Badge>}
                    {currentFeatured !== '' && isAddressEqual(r.address, currentFeatured as EvmAddress) && <Badge tone="success">Current</Badge>}
                  </label>
                ))}
              </div>
            </fieldset>
            {network === 'mainnet' && <p className="admin-note">{MAINNET_GAS}</p>}
            {feedback('featured')}
            <Button className="admin-control-action" disabled={disabled} loading={reviewing('featured')} onClick={() => void reviewFeatured()}>
              Review featured change
            </Button>
          </section>

          <section className="admin-control" aria-label="Fees">
            <h3 className="admin-control-title">Fees</h3>
            <div className="admin-fee-fields">
              <Field id="owner-donation" label="Donation fee (bps)" hint={`Now ${fee(state.donationFeeBps)}. Whole number, 500 at most.`}>
                <input className="ui-input" inputMode="numeric" value={donationValue} onChange={(e) => setDonation(e.target.value)} />
              </Field>
              <Field id="owner-withdraw" label="Withdrawal fee (bps)" hint={`Now ${fee(state.withdrawFeeBps)}. Whole number, 500 at most.`}>
                <input className="ui-input" inputMode="numeric" value={withdrawValue} onChange={(e) => setWithdraw(e.target.value)} />
              </Field>
            </div>
            <p className="admin-note">Applies to new Fundits only.</p>
            {feedback('fees')}
            <Button className="admin-control-action" disabled={disabled} loading={reviewing('fees')} onClick={() => void reviewFees()}>
              Review fee change
            </Button>
          </section>
        </div>
      </Card>

      <div className="admin-danger">
        <Card title="Danger zone" state="ready">
          <div className="admin-settings-body">
            <section className="admin-control" aria-label="New Fundits">
              <h3 className="admin-control-title">{state.paused ? 'Unpause new Fundits' : 'Pause new Fundits'}</h3>
              <p className="admin-note">
                Now: {state.paused ? 'paused. No one can create a new Fundit.' : 'open. Anyone can create a new Fundit.'}
              </p>
              {feedback('pause')}
              <Button
                className="admin-control-action"
                variant="danger"
                disabled={disabled}
                loading={reviewing('pause')}
                onClick={() => void review('pause', async () => ({ kind: state.paused ? 'unpauseCreation' : 'pauseCreation' }))}
              >
                {state.paused ? 'Review unpause' : 'Review pause'}
              </Button>
            </section>

            <section className="admin-control" aria-label="Treasury">
              <h3 className="admin-control-title">Treasury</h3>
              <div className="admin-row admin-settings-now">
                <span className="admin-row-label">Now</span>
                <Address address={state.treasury} network={network} label="treasury" />
              </div>
              <Field id="owner-treasury" label="New treasury address">
                <input className="ui-input" autoComplete="off" spellCheck={false} value={treasury} onChange={(e) => setTreasury(e.target.value)} />
              </Field>
              <Field id="owner-treasury-again" label="Enter it again to confirm">
                <input className="ui-input" autoComplete="off" spellCheck={false} value={treasuryAgain} onChange={(e) => setTreasuryAgain(e.target.value)} />
              </Field>
              {feedback('treasury')}
              <Button className="admin-control-action" variant="danger" disabled={disabled} loading={reviewing('treasury')} onClick={() => void reviewTreasury()}>
                Review treasury change
              </Button>
            </section>
          </div>
        </Card>
      </div>

      <Dialog open={pending !== null && shown !== null} onClose={() => send({ type: 'cancel' })} title={pending ? dialogTitle(pending, network) : ''}>
        {pending && shown && (
          <div className="admin-confirm">
            {network === 'mainnet' && (
              <Banner tone="attention">
                <p>{MAINNET_GAS}</p>
              </Banner>
            )}
            <dl className="admin-details">
              <Row label="Factory">
                <Address address={factoryAddress} network={network} label="factory" />
              </Row>
              <Row label="Function">
                <code>{shown.functionName}</code>
              </Row>
              <Row label="Now">
                <span className="admin-confirm-value">{shown.current}</span>
              </Row>
              <Row label="After">
                <span className="admin-confirm-value">{shown.next}</span>
              </Row>
            </dl>
            {shown.note && <p className="admin-note">{shown.note}</p>}
            {confirmKind(pending) === 'typed' && (
              <Field id="owner-typed" label={TYPED_PROMPT}>
                <input className="ui-input" autoComplete="off" spellCheck={false} maxLength={4} value={typed} onChange={(e) => setTyped(e.target.value)} />
              </Field>
            )}
            <Actions>
              <Button variant="secondary" onClick={() => send({ type: 'cancel' })}>
                Cancel
              </Button>
              <Button disabled={!typedOk} onClick={() => void confirmAndSign()}>
                Confirm and sign
              </Button>
            </Actions>
          </div>
        )}
      </Dialog>
    </>
  )
}
