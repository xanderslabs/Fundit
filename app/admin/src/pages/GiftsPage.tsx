import { useEffect, useState } from 'react'
import { Button, Stat } from '../../../src/components/ui'
import type { TokenSymbol } from '../../../src/config'
import { formatAmount } from '../../../src/lib/format'
import { giftStats } from '../lib/giftLogs'
import { CONFIRMATIONS } from '../lib/historyScan'
import { ADMIN_NETWORKS } from '../lib/networks'
import { useSnapshot } from '../lib/queries'
import type { ByToken } from '../lib/stats'
import { useScan } from '../scan/ScanProvider'
import { Card } from '../ui/Card'
import { usePanel } from '../ui/Shell'

const TOKENS_SHOWN: TokenSymbol[] = ['USDC', 'EURC']

function PerToken({ label, value }: { label: string; value: ByToken }) {
  return (
    <dl className="admin-stats">
      {TOKENS_SHOWN.map((t) => (
        <Stat key={t} term label={`${label} (${t})`} value={formatAmount(value[t], t)} />
      ))}
    </dl>
  )
}

// Ticks every second while a countdown is shown.
function useClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

function ScanCard({ deployBlock }: { deployBlock: bigint }) {
  const { state, status, progress, canSave, rescan } = useScan()
  const counting = status.resumeAt !== undefined
  const now = useClock(counting)
  const seconds = counting ? Math.max(0, Math.ceil((status.resumeAt! - now) / 1000)) : 0

  const { readTo, head } = progress
  const started = head > 0n && readTo >= deployBlock
  // Share of the blocks the scan will read, from the deploy block to CONFIRMATIONS behind the head.
  const span = head - CONFIRMATIONS - deployBlock + 1n
  const percent = !started || span <= 0n ? 0 : Math.min(100, Number(((readTo - deployBlock + 1n) * 100n) / span))

  let line: string
  if (status.kind === 'waiting') line = `The RPC asked us to slow down. Resuming in ${seconds} s.`
  else if (status.kind === 'error')
    line = `Couldn't read the history (${status.message}).${counting ? ` Trying again in ${seconds} s.` : ''}`
  else if (status.kind === 'caughtUp') line = 'Up to date. Checks for new blocks every minute.'
  // No state yet: the scan has not started, as it needs the Fundit list first.
  else if (!state) line = 'Waiting for the Fundit list before the scan starts.'
  else line = 'Reading the history, one block range at a time.'

  return (
    <Card title="History scan" state="ready" source="Read from the RPC in this browser and saved here only.">
      <div className="admin-scan">
        <div
          className="admin-scan-track"
          role="progressbar"
          aria-label="History read"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="admin-scan-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="admin-scan-text">
          {started ? `Read up to block ${readTo} of ${head}` : `Starting at block ${deployBlock}`}
        </p>
        <p className={status.kind === 'error' ? 'admin-scan-text admin-scan-error' : 'admin-scan-text'} role="status">
          {line}
        </p>
        {!canSave && <p className="admin-scan-text">This browser can't save the scan, so it starts again next visit.</p>}
        <div>
          <Button variant="secondary" onClick={rescan}>
            Rescan from start
          </Button>
        </div>
      </div>
    </Card>
  )
}

// Gift figures from the history scan, per token, and the scan's own progress.
export function GiftsPage() {
  const { session, network, showTest } = usePanel()
  const { deployBlock } = ADMIN_NETWORKS[network]
  const scan = useScan()
  // The same snapshot read as the scan and the other pages.
  const snapshot = useSnapshot(session, network)

  const state = snapshot.isError && !snapshot.data ? 'error' : snapshot.data && scan.state ? 'ready' : 'loading'
  const s = snapshot.data && scan.state ? giftStats(scan.state.events, snapshot.data, showTest, network) : null
  const partial = scan.status.kind !== 'caughtUp'

  return (
    <div className="admin-tiles">
      <Card
        title="Gifts since launch"
        state={state}
        onRetry={() => void snapshot.refetch()}
        source={`Donated and FeesClaimed events from block ${deployBlock}. USDC and EURC are never added together.`}
      >
        {s && (
          <div className="admin-tile-body">
            {partial && <p className="admin-scan-text">Partial: read up to block {scan.progress.readTo.toString()}</p>}
            <dl className="admin-stats">
              <Stat term label="Gifts" value={String(s.gifts)} />
              <Stat term label="Donors" value={String(s.uniqueDonors)} />
              <Stat term label="Repeat donors" value={String(s.repeatDonors)} />
            </dl>
            <PerToken label="Average gift" value={s.averageGift} />
            <PerToken label="Tips" value={s.tips} />
            <PerToken label="Fees charged" value={s.fees} />
            <PerToken label="Fees claimed" value={s.feesClaimed} />
          </div>
        )}
      </Card>
      <ScanCard deployBlock={deployBlock} />
    </div>
  )
}
