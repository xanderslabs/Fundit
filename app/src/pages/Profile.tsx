import { useQuery } from '@tanstack/react-query'
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { Address } from 'viem'
import { SignInButton, useSignOut } from '../components/AccountMenu'
import { AccountWithdraw } from '../components/AccountWithdraw'
import { AddBackupPasskey } from '../components/AddBackupPasskey'
import { AddMoneyPanel } from '../components/AddMoneyPanel'
import { CopyAddress } from '../components/AddressTools'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { PendingBridgeTracker } from '../components/PendingBridgeTracker'
import { ShareDialog } from '../components/SharePanel'
import { Tabs } from '../components/Tabs'
import { EXPLORER_URL } from '../config'
import { blockTimes } from '../hooks/useActivity'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { type DonationItem, recentDonationsBy } from '../lib/activity'
import { readMessage } from '../lib/anon'
import { pendingCrossChain, pendingPayouts, subscribePending } from '../lib/bridge'
import { myCampaigns } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { balancesKey, fetchAccountBalances } from '../lib/deposit'
import { formatAmount } from '../lib/format'
import { readPasskeyUsername, type StoredPasskey, syncBackupFromChain, useBackupNeeded, usePasskeySession } from '../lib/passkey'
import type { Sender } from '../lib/sender'

// Money can arrive at the address from anywhere, so the balance is read again on a timer.
const BALANCE_POLL_MS = 15_000

type Panel = 'add' | 'send'

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
        {anonymous && <p className="muted">Given with name hidden</p>}
        {text !== '' && <p className="activity-message">{text}</p>}
      </div>
      <a className="muted activity-time" href={`${EXPLORER_URL}/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer">
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
        <p className="muted">The Fundits you started.</p>
        <Link to="/create" className="btn">
          Start a Fundit
        </Link>
      </div>
      {query.isError ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : (
        <CampaignGrid
          views={query.data}
          loading={query.isPending}
          skeletons={3}
          action={(v) => (
            <>
              <Link to={`/manage/${v.address}`} className="btn btn-outline" aria-label={`Manage ${v.summary.meta.title || 'Untitled Fundit'}`}>
                Manage
              </Link>
              <ShareDialog address={v.address} title={v.summary.meta.title} isCreator />
            </>
          )}
          empty={<p>You have not started a Fundit yet.</p>}
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
      {query.isPending && <p className="muted">Loading your gifts...</p>}
      {query.isError && (
        <p className="muted">
          Could not load your gifts.{' '}
          <button type="button" className="btn btn-outline" onClick={() => query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {query.isSuccess && query.data.items.length === 0 && <p className="empty">No gifts from this account recently.</p>}
      {query.isSuccess && query.data.items.length > 0 && (
        <ol className="activity-list gift-list">
          {query.data.items.map((item) => (
            <DonationRow key={`${item.txHash}-${item.logIndex}`} item={item} time={query.data.times.get(item.blockNumber)} />
          ))}
        </ol>
      )}
      <p className="hint">
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

function AccountTab({
  address,
  username,
  backup,
  onSaveNow,
}: {
  address: Address
  username: string | null
  backup: 'saved' | 'missing' | 'checking'
  onSaveNow: () => void
}) {
  const signOut = useSignOut()
  const pending = useHasPending(address)
  return (
    <div className="dash-tab dash-account">
      <section className="dash-account-row" aria-labelledby="dash-recovery-heading">
        <h3 id="dash-recovery-heading">Recovery key</h3>
        {backup === 'saved' && <p>Recovery key saved</p>}
        {backup === 'checking' && <p className="muted">Checking...</p>}
        {backup === 'missing' && (
          <div className="dash-inline">
            <p>Not saved yet</p>
            <button type="button" className="btn" onClick={onSaveNow}>
              Save now
            </button>
          </div>
        )}
      </section>
      <section className="dash-account-row" aria-labelledby="dash-passkey-heading">
        <h3 id="dash-passkey-heading">Passkey</h3>
        {username && (
          <p>
            Username: <strong>{username}</strong>
          </p>
        )}
        <p className="muted">Your Fundit account address on Arc:</p>
        <CopyAddress address={address} />
        <a className="section-link" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
          View on the Arc explorer
        </a>
      </section>
      <section className="dash-account-row" aria-labelledby="dash-pending-heading">
        <h3 id="dash-pending-heading">Transfers on their way</h3>
        {!pending && <p className="muted">No transfers on their way.</p>}
        {/* A transfer started while cross-chain was on may still arrive, so it is tracked either way. */}
        <PendingBridgeTracker campaign={address} destination="your Fundit account" />
        <PendingBridgeTracker campaign={address} kind="payout" />
      </section>
      <div>
        <button type="button" className="btn btn-outline" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function BalanceCard({
  address,
  username,
  open,
  onToggle,
  addRef,
  sendRef,
}: {
  address: Address
  username: string | null
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
    v !== undefined ? formatAmount(v, symbol).split(' ')[0] : balances.isError ? '-' : '...'
  return (
    <section className="dash-card" aria-label="Your Fundit account">
      <div className="dash-id">
        <p className="dash-name">{username ?? 'Fundit account'}</p>
        <CopyAddress address={address} short />
      </div>
      <dl className="dash-balances" aria-live="polite">
        <div>
          <dt>USDC</dt>
          <dd>{amount(balances.data?.usdc, 'USDC')}</dd>
        </div>
        <div>
          <dt>EURC</dt>
          <dd>{amount(balances.data?.eurc, 'EURC')}</dd>
        </div>
      </dl>
      {balances.isError && <p className="hint">Could not read your balance. It will try again.</p>}
      <div className="dash-actions">
        <button
          ref={addRef}
          type="button"
          className="btn btn-lg"
          aria-expanded={open === 'add'}
          aria-controls="dash-panel-add"
          onClick={() => onToggle('add')}
        >
          Add money
        </button>
        <button
          ref={sendRef}
          type="button"
          className="btn btn-lg btn-outline"
          aria-expanded={open === 'send'}
          aria-controls="dash-panel-send"
          onClick={() => onToggle('send')}
        >
          Send
        </button>
      </div>
    </section>
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
      <button type="button" className="share-close dash-panel-close" aria-label={`Close ${label}`} onClick={onClose}>
        <CloseIcon />
      </button>
      {children}
    </div>
  )
}

function Dashboard({ sender, stored }: { sender: Sender; stored: StoredPasskey }) {
  const address = stored.address
  const [username] = useState(() => readPasskeyUsername(address))
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

  // A new browser has no flag yet, so the chain decides. A failed read falls back to the flag: the banner shows.
  const backupNeeded = useBackupNeeded(stored)
  const backupOnChain = useQuery({
    queryKey: ['backup-on-chain', address.toLowerCase()],
    queryFn: () => syncBackupFromChain(address),
    enabled: backupNeeded,
    retry: false,
    staleTime: Infinity,
  })
  const showBackup = backupNeeded && (backupOnChain.isError || backupOnChain.data === false)
  const backupState = !backupNeeded ? 'saved' : showBackup ? 'missing' : 'checking'
  const [backupOpen, setBackupOpen] = useState(false)
  const banner = useRef<HTMLElement>(null)

  function saveNow() {
    setBackupOpen(true)
    banner.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    banner.current?.focus()
  }

  return (
    <div className="dashboard">
      <h1 className="sr-only">My page</h1>
      <BalanceCard
        address={address}
        username={username}
        open={open}
        onToggle={(p) => setOpen(open === p ? null : p)}
        addRef={addButton}
        sendRef={sendButton}
      />

      <DashPanel id="dash-panel-add" label="Add money" open={open === 'add'} onClose={() => close('add')}>
        {opened.add && (
          <section className="panel manage-section" aria-labelledby="dash-add-heading">
            <h2 id="dash-add-heading">Add money</h2>
            <p className="hint">Network fees on Arc are paid in USDC from your balance, so keep a little extra.</p>
            <AddMoneyPanel account={address} />
          </section>
        )}
      </DashPanel>
      <DashPanel id="dash-panel-send" label="Send" open={open === 'send'} onClose={() => close('send')}>
        {opened.send && <AccountWithdraw sender={sender} />}
      </DashPanel>

      {showBackup && (
        <section ref={banner} tabIndex={-1} className="dash-banner" aria-label="Recovery key">
          {backupOpen ? (
            <AddBackupPasskey stored={stored} />
          ) : (
            <>
              <p>
                <strong>Save a recovery key so you never lose this account</strong>
              </p>
              <button type="button" className="btn" onClick={() => setBackupOpen(true)}>
                Save now
              </button>
            </>
          )}
        </section>
      )}

      <Tabs
        label="My page"
        className="dash-tabs"
        tabs={[
          { id: 'fundits', label: 'Your Fundits', content: <YourFundits address={address} /> },
          { id: 'gifts', label: 'Your gifts', content: <YourGifts address={address} /> },
          {
            id: 'account',
            label: 'Account',
            content: <AccountTab address={address} username={username} backup={backupState} onSaveNow={saveNow} />,
          },
        ]}
      />
    </div>
  )
}

export function Profile() {
  const sender = useSender()
  const session = usePasskeySession()

  if (!sender || !session) {
    return (
      <section className="notice">
        <h1>My page</h1>
        <p>Sign in to see your Fundits and the donations you made.</p>
        <SignInButton />
      </section>
    )
  }

  return <Dashboard sender={sender} stored={session} />
}
