import { Link } from 'react-router'
import { Button } from '../../../src/components/ui'
import type { TokenSymbol } from '../../../src/config'
import { matchesWorker } from '../lib/api'
import { latestFeed, type FeedItem } from '../lib/feed'
import { giftStats } from '../lib/giftLogs'
import type { ScanEvent } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { STALE_AFTER_MS, useHealth, useSnapshot } from '../lib/queries'
import type { FunditSnapshot } from '../lib/snapshot'
import { type ByToken, claimable, liveCount, newThisWeek, raisedByToken, visible } from '../lib/stats'
import { blockClock, perDay } from '../lib/trends'
import { Amount } from '../ui/Amount'
import { ago, Card } from '../ui/Card'
import { ExternalLinkIcon } from '../ui/icons'
import { ScanNote } from '../ui/ScanNote'
import { usePanel } from '../ui/Shell'
import { Sparkline } from '../ui/Sparkline'
import { useScan } from '../scan/ScanProvider'

const TOKENS: TokenSymbol[] = ['USDC', 'EURC']
const FEED_LIMIT = 8
const GIFT_TREND_DAYS = 14
const count = new Intl.NumberFormat('en-US')

// Links keep the network, as the sidebar's do.
function search(network: AdminNetwork): string {
  return network === 'testnet' ? '?network=testnet' : ''
}

// Gifts the figures count: to a shown Fundit, and from a test donor only with test data on.
function shownGifts(events: ScanEvent[], rows: FunditSnapshot[], showTest: boolean, network: AdminNetwork): ScanEvent[] {
  const { testCreators } = ADMIN_NETWORKS[network]
  const shown = new Set(rows.map((r) => r.address.toLowerCase()))
  return events.filter(
    (e) =>
      e.kind === 'Donated' &&
      shown.has(e.address.toLowerCase()) &&
      (showTest || !testCreators.includes((e.args.donor as string).toLowerCase())),
  )
}

type PillState = 'ok' | 'failing' | 'unknown'

function HealthStrip({ network }: { network: AdminNetwork }) {
  const health = useHealth(network)
  const report = health.data

  if (!report) {
    return (
      <section className="admin-health-strip" aria-label="Health">
        {health.isError ? (
          <p className="admin-health-error" role="alert">
            Couldn't load health.{' '}
            <Button variant="secondary" onClick={() => void health.refetch()}>
              Try again
            </Button>
          </p>
        ) : (
          <span className="admin-skeleton-line admin-health-skeleton" aria-hidden="true" />
        )}
      </section>
    )
  }

  const check = (key: string): PillState => {
    const c = report.checks.find((x) => x.key === key)
    return !c ? 'unknown' : c.ok ? 'ok' : 'failing'
  }
  const pills: { label: string; state: PillState }[] = [
    { label: 'Site', state: check('site') },
    { label: 'Email sign-in', state: check('ucw') },
    { label: 'RPC', state: check(`rpc:arc-${network}`) },
    // Red until the "Owner alerts started" message has gone out.
    { label: 'Alerts', state: report.alertsStarted ? 'ok' : 'failing' },
  ]
  const word = { ok: 'OK', failing: 'Failing', unknown: 'Not checked yet' }

  return (
    <section className="admin-health-strip" aria-label="Health">
      <ul className="admin-pills">
        {pills.map(({ label, state }) => {
          const body = (
            <>
              <span className="admin-pill-dot" aria-hidden="true" />
              <span className="admin-pill-label">{label}</span>
              <span className="admin-pill-state">{word[state]}</span>
            </>
          )
          return (
            <li key={label}>
              {state === 'failing' ? (
                <Link className={`admin-pill admin-pill-${state}`} to={{ pathname: '/health', search: search(network) }}>
                  {body}
                </Link>
              ) : (
                <span className={`admin-pill admin-pill-${state}`}>{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PerToken({ value }: { value: ByToken }) {
  return (
    <ul className="admin-figure-lines">
      {TOKENS.map((t) => (
        <li key={t}>
          <Amount value={value[t]} token={t} />
        </li>
      ))}
    </ul>
  )
}

function Figure({ value }: { value: number }) {
  return <p className="admin-figure">{count.format(value)}</p>
}

function feedTime(item: FeedItem, rows: FunditSnapshot[], clock: ((b: bigint) => bigint) | null, nowMs: number): string {
  if (item.kind === 'newFundit') {
    const row = rows.find((r) => r.address === item.address)
    if (row) return ago(nowMs - Number(row.createdAt) * 1000)
  }
  if (!clock) return `Block ${item.blockNumber}`
  return `About ${ago(nowMs - Number(clock(item.blockNumber)) * 1000)}`
}

export function OverviewPage() {
  const { session, network, showTest } = usePanel()
  const snapshot = useSnapshot(session, network)
  const scan = useScan()
  const { explorerUrl } = ADMIN_NETWORKS[network]

  if (!matchesWorker(session, network)) return <p className="admin-error">This panel was built for another network.</p>

  const all = snapshot.data
  const rows = all ? visible(all, showTest) : null
  const nowMs = Date.now()
  const nowSec = BigInt(Math.floor(nowMs / 1000))
  const snapState = rows ? 'ready' : snapshot.isError ? 'error' : 'loading'
  const scanState = rows && scan.state ? 'ready' : snapshot.isError && !rows ? 'error' : 'loading'

  const clock = all ? blockClock(all) : null
  const gifts = all && rows && scan.state ? shownGifts(scan.state.events, rows, showTest, network) : []
  const stats = all && scan.state ? giftStats(scan.state.events, all, showTest, network) : null
  const giftTimes = clock ? gifts.map((e) => clock(e.blockNumber)) : []
  const created = rows ? rows.map((r) => r.createdAt) : []
  const createdThisWeek = rows ? newThisWeek(rows, nowSec) : 0

  // The feed counts settings changes and the gifts the figures count.
  const feed =
    rows && scan.state
      ? latestFeed([...gifts, ...scan.state.events.filter((e) => e.kind !== 'Donated')], rows, FEED_LIMIT)
      : []

  const common = {
    updatedAt: snapshot.dataUpdatedAt || undefined,
    staleAfterMs: STALE_AFTER_MS,
    onRefresh: () => void snapshot.refetch(),
    onRetry: () => void snapshot.refetch(),
    error: snapshot.error,
  }

  return (
    <div className="admin-page">
      <HealthStrip network={network} />

      <div className="admin-headline">
        <Card title="Raised" state={snapState} {...common} source="Each Fundit's raised total. USDC and EURC are kept apart.">
          {rows && <PerToken value={raisedByToken(rows)} />}
        </Card>
        <Card title="Gifts" state={scanState} {...common} source="Donated events from the history scan.">
          {stats && (
            <>
              <Figure value={stats.gifts} />
              {giftTimes.length >= 2 && (
                <Sparkline points={perDay(giftTimes, GIFT_TREND_DAYS, nowSec)} label={`Gifts per day over the last ${GIFT_TREND_DAYS} days, from estimated block times`} />
              )}
              <ScanNote />
            </>
          )}
        </Card>
        <Card title="Donors" state={scanState} {...common} source="Different donor addresses in the history scan.">
          {stats && (
            <>
              <Figure value={stats.uniqueDonors} />
              <ScanNote />
            </>
          )}
        </Card>
        <Card title="Live Fundits" state={snapState} {...common} source="Fundits that are not closed.">
          {rows && <Figure value={liveCount(rows)} />}
        </Card>
        <Card title="New Fundits this week" state={snapState} {...common} source="Created in the last 7 days.">
          {rows && (
            <>
              <Figure value={createdThisWeek} />
              {createdThisWeek >= 2 && <Sparkline points={perDay(created, 7, nowSec)} label="New Fundits per day over the last 7 days" />}
            </>
          )}
        </Card>
        <Card title="Fees waiting to be claimed" state={snapState} {...common} source="Fees booked in each Fundit plus the fee on gifts not yet counted.">
          {rows && <PerToken value={claimable(rows)} />}
        </Card>
      </div>

      <Card title="Latest activity" state={scanState} {...common} source={clock ? 'Times for gifts and settings changes are estimated from block numbers.' : undefined}>
        {rows && scan.state && (
          <div className="admin-feed-wrap">
            <ScanNote />
            {feed.length === 0 ? (
              <p className="admin-note">Nothing has happened yet.</p>
            ) : (
              <ol className="admin-feed">
                {feed.map((item) => (
                  <li key={`${item.kind}:${item.blockNumber}:${item.logIndex}:${item.address}`} className="admin-feed-item">
                    <span className={`admin-feed-dot admin-feed-${item.kind}`} aria-hidden="true" />
                    <span className="admin-feed-text" dir="auto" title={item.text}>
                      {item.text}
                    </span>
                    <span className="admin-feed-time" title={`Block ${item.blockNumber}`}>
                      {feedTime(item, rows, clock, nowMs)}
                    </span>
                    <a
                      className="admin-icon-button admin-icon-button-sm"
                      href={item.txHash ? `${explorerUrl}/tx/${item.txHash}` : `${explorerUrl}/address/${item.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={item.txHash ? 'View transaction on explorer' : 'View Fundit on explorer'}
                    >
                      <ExternalLinkIcon />
                    </a>
                  </li>
                ))}
              </ol>
            )}
            <Link className="admin-view-all" to={{ pathname: '/activity', search: search(network) }}>
              View all
            </Link>
          </div>
        )}
      </Card>
    </div>
  )
}
