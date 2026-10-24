import { useQuery } from '@tanstack/react-query'
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { Address } from 'viem'
import { useSignOut } from '../components/AccountMenu'
import { AccountWithdraw } from '../components/AccountWithdraw'
import { AddMoneyPanel } from '../components/AddMoneyPanel'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { PendingBridgeTracker } from '../components/PendingBridgeTracker'
import { ShareDialog } from '../components/SharePanel'
import { AddressChip, Button, ButtonLink, Card, EmptyState, Panel, Stat, TabPanel, Tabs } from '../components/ui'
import { EXPLORER_URL } from '../config'
import { blockTimes } from '../hooks/useActivity'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { type Account, useAccount } from '../lib/account'
import { type DonationItem, recentDonationsBy } from '../lib/activity'
import { readMessage } from '../lib/anon'
import { pendingCrossChain, pendingPayouts, subscribePending } from '../lib/bridge'
import { myCampaigns } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { balancesKey, fetchAccountBalances } from '../lib/deposit'
import { readEmailSession } from '../lib/emailAccount'
import { formatAmount } from '../lib/format'
import { shortAddress } from '../lib/names'
import type { Sender } from '../lib/sender'
import { SignInRequired } from './SignInRequired'
import './Profile.css'

// Money can arrive at the address from anywhere, so the balance is read again on a timer.
const BALANCE_POLL_MS = 15_000

type Panel = 'add' | 'send'

const DASH_TABS: { id: DashTab; label: string }[] = [
  { id: 'dash-fundits', label: 'Your Fundits' },
  { id: 'dash-gifts', label: 'Your gifts' },
  { id: 'dash-account', label: 'Account' },
]
type DashTab = 'dash-fundits' | 'dash-gifts' | 'dash-account'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

function DonationRow({ item, time }: { item: DonationItem; time: bigint | undefined }) {
  // Only factory campaigns reach this list, and their token never changes, so the symbol is safe to read here.
  const campaign = useCampaign(item.campaign)
  const view = campaign.data && campaign.data !== 'not-a-campaign' ? campaign.data : null
  const { anonymous, text } = readMessage(item.data.message as string)
  return (
    <li className="gift-row">
      <div className="gift-main">
        <p>
          {view ? (
            <>
              You gave <strong>{formatAmount(item.data.amount as bigint, view.symbol)}</strong> to{' '}
              <Link to={`/c/${item.campaign}`}>{view.summary.meta.title || 'Untitled Fundit'}</Link>
            </>
          ) : (
            <Link to={`/c/${item.campaign}`}>A donation you made</Link>
          )}
        </p>
        {anonymous && <p className="dash-muted">Given with name hidden</p>}
        {text !== '' && <p className="gift-message">{text}</p>}
      </div>
      <a className="gift-time" href={`${EXPLORER_URL}/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer">
        {time === undefined ? `Block ${item.blockNumber}` : new Date(Number(time) * 1000).toLocaleString()}
      </a>
    </li>
  )
}

function YourFundits({ address }: { address: Address }) {
  const query = useQuery({
    queryKey: ['my-campaigns', address.toLowerCase()],
    queryFn: () => myCampaigns(arcClient, address),
    staleTime: 15_000,
  })
  return (
    <div className="dash-tab">
      <div className="dash-tab-head">
        <p className="dash-muted">The Fundits you started.</p>
        <ButtonLink to="/create">Start a Fundit</ButtonLink>
      </div>
      {query.isError ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : query.isSuccess && query.data.length === 0 ? (
        <EmptyState>You have not started a Fundit yet.</EmptyState>
      ) : (
        <CampaignGrid
          views={query.data}
          loading={query.isPending}
          skeletons={3}
          action={(v) => (
            <>
              <ButtonLink to={`/manage/${v.address}`} variant="secondary" aria-label={`Manage ${v.summary.meta.title || 'Untitled Fundit'}`}>
                Manage
              </ButtonLink>
              <ShareDialog address={v.address} title={v.summary.meta.title} isCreator />
            </>
          )}
          // The branch above shows the empty state, so CampaignGrid's own (boxed) one is never used here.
          empty={null}
        />
      )}
    </div>
  )
}

function YourGifts({ address }: { address: Address }) {
  const query = useQuery({
    queryKey: ['my-donations', address.toLowerCase()],
    queryFn: async () => {
      const items = await recentDonationsBy(arcClient, address)
      return { items, times: await blockTimes(arcClient, items.map((i) => i.blockNumber)) }
    },
    staleTime: 15_000,
  })
  return (
    <div className="dash-tab">
      {query.isPending && <p className="dash-muted">Loading your gifts...</p>}
      {query.isError && (
        <EmptyState
          action={
            <Button variant="secondary" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          Could not load your gifts.
        </EmptyState>
      )}
      {query.isSuccess && query.data.items.length === 0 && <EmptyState>No gifts from this account recently.</EmptyState>}
      {query.isSuccess && query.data.items.length > 0 && (
        <ol className="gift-list">
          {query.data.items.map((item) => (
            <DonationRow key={`${item.txHash}-${item.logIndex}`} item={item} time={query.data.times.get(item.blockNumber)} />
          ))}
        </ol>
      )}
      <p className="dash-note">
        This list covers about the last day on Arc.{' '}
        <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
          Older gifts: view on explorer
        </a>
      </p>
    </div>
  )
}

// True while a transfer to this account, or a payout from it, is still on its way.
function hasPending(address: Address) {
  const a = address.toLowerCase()
  return [...pendingCrossChain(), ...pendingPayouts()].some((b) => b.campaign.toLowerCase() === a)
}

function useHasPending(address: Address) {
  const [pending, setPending] = useState(() => hasPending(address))
  useEffect(() => {
    const reload = () => setPending(hasPending(address))
    reload()
    return subscribePending(reload)
  }, [address])
  return pending
}

function AccountTab({ account }: { account: Account }) {
  const address = account.address
  const signOut = useSignOut()
  const pending = useHasPending(address)
  return (
    <div className="dash-tab dash-account">
      <section className="dash-account-row" aria-labelledby="dash-signin-heading">
        <h3 id="dash-signin-heading">Sign-in</h3>
        {account.kind === 'email' && (
          <p>
            Email: <strong>{readEmailSession()?.email}</strong>
          </p>
        )}
        {account.kind === 'wallet' && (
          <p>
            Wallet: <code title={address}>{shortAddress(address)}</code>
          </p>
        )}
        <p className="dash-muted">Your Fundit account address on Arc:</p>
        {/* The full address here, so it can be checked character by character. */}
        <AddressChip address={address} full />
        <a className="dash-link" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
          View on the Arc explorer
        </a>
      </section>
      <section className="dash-account-row" aria-labelledby="dash-pending-heading">
        <h3 id="dash-pending-heading">Transfers on their way</h3>
        {!pending && <p className="dash-muted">No transfers on their way.</p>}
        {/* A transfer started while cross-chain was on may still arrive, so it is tracked either way. */}
        <PendingBridgeTracker campaign={address} destination="your Fundit account" />
        <PendingBridgeTracker campaign={address} kind="payout" />
      </section>
      <div className="dash-signout">
        <Button variant="secondary" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

function BalanceCard({
  address,
  open,
  onToggle,
  addRef,
  sendRef,
}: {
  address: Address
  open: Panel | null
  onToggle: (p: Panel) => void
  addRef: Ref<HTMLButtonElement>
  sendRef: Ref<HTMLButtonElement>
}) {
  const balances = useQuery({
    queryKey: balancesKey(address),
    queryFn: () => fetchAccountBalances(arcClient, address),
    staleTime: 15_000,
    refetchInterval: BALANCE_POLL_MS,
  })
  const amount = (v: bigint | undefined, symbol: 'USDC' | 'EURC') =>
    v !== undefined ? formatAmount(v, symbol).split(' ')[0]! : balances.isError ? '-' : '...'
  return (
    <Card className="account-card" label="Your Fundit account">
      <div className="account-card-top">
        <p className="account-card-name">Fundit account</p>
        <AddressChip address={address} />
      </div>
      {/* dash-balances has no styles: the e2e reads the balance through it. */}
      <dl className="dash-balances account-card-balances" aria-live="polite">
        <Stat term size="lg" label="USDC" value={amount(balances.data?.usdc, 'USDC')} />
        <Stat term size="lg" label="EURC" value={amount(balances.data?.eurc, 'EURC')} />
      </dl>
      {balances.isError && <p className="dash-note">Could not read your balance. It will try again.</p>}
      <div className="account-card-actions">
        <Button ref={addRef} size="lg" aria-expanded={open === 'add'} aria-controls="dash-panel-add" onClick={() => onToggle('add')}>
          Add money
        </Button>
        <Button
          ref={sendRef}
          variant="secondary"
          size="lg"
          aria-expanded={open === 'send'}
          aria-controls="dash-panel-send"
          onClick={() => onToggle('send')}
        >
          Send
        </Button>
      </div>
    </Card>
  )
}

// One inline panel under the balance card. It stays mounted once opened, so a send in flight keeps its status
// and lock when the panel is closed.
function DashPanel({ id, label, open, onClose, children }: { id: string; label: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [open])
  // Close comes first in the DOM, so the Tab order matches where it is drawn (top right). Escape closes too.
  return (
    <div
      ref={ref}
      id={id}
      className="dash-panel"
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <button type="button" className="dash-panel-close" aria-label={`Close ${label}`} onClick={onClose}>
        <CloseIcon />
      </button>
      {children}
    </div>
  )
}

function Dashboard({ sender, account }: { sender: Sender; account: Account }) {
  const address = account.address
  const [params, setParams] = useSearchParams()
  // The open panel lives in the address bar (?add=1 or ?send=1), so every Add money link can open it.
  const open: Panel | null = params.get('add') === '1' ? 'add' : params.get('send') === '1' ? 'send' : null
  const [opened, setOpened] = useState<Record<Panel, boolean>>({ add: false, send: false })
  if (open && !opened[open]) setOpened({ ...opened, [open]: true })
  const addButton = useRef<HTMLButtonElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)

  function setOpen(next: Panel | null) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete('add')
        p.delete('send')
        if (next) p.set(next, '1')
        return p
      },
      { replace: true },
    )
  }

  function close(which: Panel) {
    setOpen(null)
    ;(which === 'add' ? addButton : sendButton).current?.focus()
  }

  const [tab, setTab] = useState<DashTab>('dash-fundits')

  return (
    <div className="dashboard">
      <h1 className="sr-only">My page</h1>
      <BalanceCard
        address={address}
        open={open}
        onToggle={(p) => setOpen(open === p ? null : p)}
        addRef={addButton}
        sendRef={sendButton}
      />

      <DashPanel id="dash-panel-add" label="Add money" open={open === 'add'} onClose={() => close('add')}>
        {opened.add && (
          <Panel title="Add money" headingId="dash-add-heading" description="Network fees on Arc are paid in USDC from your balance, so keep a little extra.">
            <AddMoneyPanel account={address} />
          </Panel>
        )}
      </DashPanel>
      <DashPanel id="dash-panel-send" label="Send" open={open === 'send'} onClose={() => close('send')}>
        {opened.send && <AccountWithdraw sender={sender} />}
      </DashPanel>

      <div>
        <Tabs label="My page" tabs={DASH_TABS} value={tab} onChange={(id) => setTab(id as DashTab)} />
        {/* Only the open tab is in the page, so a list loads when its tab is first opened. */}
        <TabPanel id={tab} active>
          {tab === 'dash-fundits' && <YourFundits address={address} />}
          {tab === 'dash-gifts' && <YourGifts address={address} />}
          {tab === 'dash-account' && <AccountTab account={account} />}
        </TabPanel>
      </div>
    </div>
  )
}

export function Profile() {
  const sender = useSender()
  const account = useAccount()

  if (!sender || !account) {
    return <SignInRequired text="My page shows your Fundits and the donations you made." />
  }

  return <Dashboard sender={sender} account={account} />
}
