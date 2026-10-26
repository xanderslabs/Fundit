import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAccount, simulateContract, waitForTransactionReceipt, watchAccount, writeContract } from '@wagmi/core'
import { useEffect, useState } from 'react'
import { type Address, isAddressEqual, parseEventLogs, type TransactionReceipt, zeroAddress } from 'viem'
import { factoryAbi } from '../../src/abi/factory'
import { ConnectWallet } from '../../src/components/ConnectWallet'
import { AddressChip, Badge, Banner, Button, Field } from '../../src/components/ui'
import { CANCELLED, explainError, isUserRejection, revertText } from '../../src/lib/errors'
import { type AdminSession, matchesWorker } from './lib/api'
import { readClient } from './lib/clients'
import { readFactoryState } from './lib/factoryState'
import {
  buildCall,
  canAct,
  checkFeatured,
  checkFees,
  checkTreasury,
  describe,
  type OwnerAction,
} from './lib/ownerActions'
import { type AdminNetwork, ADMIN_NETWORKS } from './lib/networks'
import { fetchSnapshot } from './lib/snapshot'
import { ConfirmAction } from './ConfirmAction'
import { adminWagmiConfig } from './wagmi'
import { Tile } from './Tile'

type Account = { address?: Address; chainId?: number }

function fee(n: number): string {
  return `${n} bps (${n / 100}%)`
}

// One line naming the event the receipt carries, or null when the expected one is missing.
function eventText(receipt: TransactionReceipt, action: OwnerAction): string | null {
  const names = {
    setFees: 'FeesUpdated',
    setTreasury: 'TreasuryUpdated',
    setFeatured: 'FeaturedUpdated',
    pauseCreation: 'CreationPausedSet',
    unpauseCreation: 'CreationPausedSet',
  } as const
  const eventName = names[action.kind]
  const [log] = parseEventLogs({ abi: factoryAbi, eventName, logs: receipt.logs })
  if (!log) return null
  switch (log.eventName) {
    case 'FeesUpdated':
      return `FeesUpdated: donation ${fee(log.args.donationFeeBps)}, withdraw ${fee(log.args.withdrawFeeBps)}.`
    case 'TreasuryUpdated':
      return `TreasuryUpdated: ${log.args.treasury}.`
    case 'FeaturedUpdated':
      return `FeaturedUpdated: ${isAddressEqual(log.args.campaign, zeroAddress) ? 'none' : log.args.campaign}.`
    case 'CreationPausedSet':
      return `CreationPausedSet: ${log.args.paused ? 'paused' : 'open'}.`
    default:
      return null
  }
}

// The owner's controls. Each builds a CampaignFactory call that the connected owner wallet signs. The factory
// and chain come from the network; nothing is sent until the call has simulated and the owner has confirmed it.
export function OwnerControls({ session, network }: { session: AdminSession; network: AdminNetwork }) {
  const { factory: factoryAddress, chainId } = ADMIN_NETWORKS[network]
  const matches = matchesWorker(session, network)
  const queryClient = useQueryClient()
  const factory = useQuery({
    queryKey: ['admin', network, 'factory'],
    queryFn: () => readFactoryState(readClient(network), network),
    enabled: matches,
  })
  const snapshot = useQuery({
    queryKey: ['admin', network, 'snapshot'],
    queryFn: () => fetchSnapshot(readClient(network), network),
    enabled: matches,
  })

  const [account, setAccount] = useState<Account>(() => getAccount(adminWagmiConfig))
  useEffect(() => watchAccount(adminWagmiConfig, { onChange: setAccount }), [])

  const [donation, setDonation] = useState('')
  const [withdraw, setWithdraw] = useState('')
  const [treasury, setTreasury] = useState('')
  const [treasuryAgain, setTreasuryAgain] = useState('')
  // null until the owner picks; then the picker shows the factory's current featured Fundit, even after a refetch.
  const [pickedFeatured, setFeatured] = useState<string | null>(null)
  const [pending, setPending] = useState<OwnerAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const state = factory.data
  if (!matches || !state) return null
  const featured = pickedFeatured ?? (isAddressEqual(state.featured, zeroAddress) ? '' : state.featured)
  const can = canAct(account.address, account.chainId, session.address, state, network)

  const isCampaign = (a: Address) => readClient(network).readContract({ address: factoryAddress, abi: factoryAbi, functionName: 'isCampaign', args: [a] })

  function fail(e: unknown) {
    setError(isUserRejection(e) ? CANCELLED : (revertText(e) ?? explainError(e)))
  }

  // Checks the wallet again at click time, simulates, and only then opens the confirm step.
  async function review(action: OwnerAction | { refused: string }) {
    setError(null)
    setDone(null)
    if ('refused' in action) return setError(action.refused)
    const live = getAccount(adminWagmiConfig)
    const ok = canAct(live.address, live.chainId, session.address, state!, network)
    if (!ok.ok) return setError(ok.reason)
    setBusy(true)
    try {
      await simulateContract(adminWagmiConfig, { ...buildCall(action, network), account: live.address } as never)
      setPending(action)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function send(action: OwnerAction) {
    const live = getAccount(adminWagmiConfig)
    const ok = canAct(live.address, live.chainId, session.address, state!, network)
    if (!ok.ok) {
      setPending(null)
      return setError(ok.reason)
    }
    try {
      const hash = await writeContract(adminWagmiConfig, { ...buildCall(action, network), account: live.address } as never)
      const receipt = await waitForTransactionReceipt(adminWagmiConfig, { hash, chainId })
      setPending(null)
      if (receipt.status !== 'success') return setError('The transaction was mined but failed. Nothing changed.')
      setDone(eventText(receipt, action) ?? 'Confirmed, but the expected event was not in the receipt. Check the explorer.')
      await queryClient.invalidateQueries({ queryKey: ['admin', network, 'factory'] })
    } catch (e) {
      setPending(null)
      fail(e)
    }
  }

  async function reviewFees() {
    const r = checkFees(donation, withdraw)
    await review(r.ok ? { kind: 'setFees', donationBps: r.donationBps, withdrawBps: r.withdrawBps } : { refused: r.reason })
  }

  async function reviewTreasury() {
    const r = await checkTreasury(treasury, treasuryAgain, factoryAddress, isCampaign).catch(() => null)
    if (!r) return setError('We could not check that address. Try again.')
    await review(r.ok ? { kind: 'setTreasury', treasury: r.address } : { refused: r.reason })
  }

  async function reviewFeatured() {
    const r = await checkFeatured(featured, isCampaign).catch(() => null)
    if (!r) return setError('We could not check that address. Try again.')
    await review(r.ok ? { kind: 'setFeatured', campaign: r.campaign } : { refused: r.reason })
  }

  const disabled = !can.ok || busy
  const confirm = pending ? describe(pending, state) : null

  return (
    <Tile title="Owner controls" source="Each change is signed by the owner wallet and enforced by the factory contract.">
      {!can.ok && (
        <Banner tone="attention">
          <p>{can.reason}</p>
          <ConnectWallet config={adminWagmiConfig} onConnected={() => {}} />
        </Banner>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="admin-note" role="status">
          {done}
        </p>
      )}

      <section className="admin-control" aria-label="Fees">
        <h3 className="admin-control-title">Fees</h3>
        <Field id="owner-donation" label="Donation fee (bps)" hint="Whole number, 500 at most.">
          <input className="ui-input" inputMode="numeric" value={donation} onChange={(e) => setDonation(e.target.value)} placeholder={String(state.donationFeeBps)} />
        </Field>
        <Field id="owner-withdraw" label="Withdraw fee (bps)" hint="Whole number, 500 at most.">
          <input className="ui-input" inputMode="numeric" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} placeholder={String(state.withdrawFeeBps)} />
        </Field>
        <Button disabled={disabled} onClick={() => void reviewFees()}>
          Review fee change
        </Button>
      </section>

      <section className="admin-control" aria-label="Treasury">
        <h3 className="admin-control-title">Treasury</h3>
        <Field id="owner-treasury" label="New treasury address">
          <input className="ui-input" autoComplete="off" spellCheck={false} value={treasury} onChange={(e) => setTreasury(e.target.value)} />
        </Field>
        <Field id="owner-treasury-again" label="Enter it again to confirm">
          <input className="ui-input" autoComplete="off" spellCheck={false} value={treasuryAgain} onChange={(e) => setTreasuryAgain(e.target.value)} />
        </Field>
        <Button disabled={disabled} onClick={() => void reviewTreasury()}>
          Review treasury change
        </Button>
      </section>

      <section className="admin-control" aria-label="Featured Fundit">
        <h3 className="admin-control-title">Featured Fundit</h3>
        <fieldset className="admin-picker">
          <legend className="admin-note">Pick the Fundit to feature</legend>
          <label className="admin-pick">
            <input type="radio" name="featured" checked={featured === ''} onChange={() => setFeatured('')} />
            None (clear the featured Fundit)
          </label>
          {(snapshot.data ?? []).map((r) => (
            <label key={r.address} className="admin-pick">
              <input type="radio" name="featured" checked={featured.toLowerCase() === r.address.toLowerCase()} onChange={() => setFeatured(r.address)} />
              <AddressChip address={r.address} />
              {r.isTest && <Badge>Test</Badge>}
            </label>
          ))}
        </fieldset>
        <Button disabled={disabled} onClick={() => void reviewFeatured()}>
          Review featured change
        </Button>
      </section>

      <section className="admin-control" aria-label="Creation">
        <h3 className="admin-control-title">Creating new Fundits</h3>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void review({ kind: state.paused ? 'unpauseCreation' : 'pauseCreation' })}
        >
          {state.paused ? 'Unpause creation' : 'Pause creation'}
        </Button>
      </section>

      <ConfirmAction
        open={pending !== null && confirm !== null}
        title="Confirm this change"
        rows={
          confirm
            ? [
                { label: 'Factory', value: factoryAddress },
                { label: 'Function', value: confirm.functionName },
                { label: 'Now', value: confirm.current },
                { label: 'After', value: confirm.next },
              ]
            : []
        }
        note={confirm?.note}
        onConfirm={() => (pending ? send(pending) : Promise.resolve())}
        onClose={() => setPending(null)}
      />
    </Tile>
  )
}
