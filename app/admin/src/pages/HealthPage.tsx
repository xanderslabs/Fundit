import { Badge } from '../../../src/components/ui'
import { type HealthCheck } from '../lib/api'
import { STALE_AFTER_MS, useHealth } from '../lib/queries'
import { ago, Card } from '../ui/Card'
import { usePanel } from '../ui/Shell'

// The Worker stores times as epoch milliseconds; 0 means never.
function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function CheckRow({ label, check, nowMs }: { label: string; check: HealthCheck | undefined; nowMs: number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-label="Status">
        {!check ? (
          <span className="admin-muted">Not checked yet</span>
        ) : check.ok ? (
          <Badge tone="success">OK</Badge>
        ) : (
          <Badge tone="attention">{`Failing since ${utc(check.since)}`}</Badge>
        )}
      </td>
      <td className="admin-num" data-label="Failed checks">
        {check ? check.failCount : ''}
      </td>
      <td data-label="Last alert">
        {check && (check.lastSent > 0 ? `${utc(check.lastSent)} (${ago(nowMs - check.lastSent)})` : <span className="admin-muted">None sent</span>)}
      </td>
    </tr>
  )
}

export function HealthPage() {
  const { network } = usePanel()
  const health = useHealth(network)
  const report = health.data
  const nowMs = Date.now()
  const state = report ? 'ready' : health.isError ? 'error' : 'loading'
  const find = (key: string) => report?.checks.find((c) => c.key === key)
  const rows = [
    { label: 'Site', key: 'site' },
    { label: 'Email sign-in', key: 'ucw' },
    { label: 'RPC', key: `rpc:arc-${network}` },
    { label: 'Owner events', key: `events:arc-${network}` },
  ]
  // The cron stores the next block it will read, so the last one it has read is the one before.
  const lastBlock = report?.lastEventBlock ? (BigInt(report.lastEventBlock) - 1n).toString() : null

  return (
    <Card
      title="Health"
      state={state}
      updatedAt={health.dataUpdatedAt || undefined}
      staleAfterMs={STALE_AFTER_MS}
      onRefresh={() => void health.refetch()}
      onRetry={() => void health.refetch()}
      source="Kept by the Worker's checks, which run every 5 minutes."
    >
      {report && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="admin-num">
                    Failed checks
                  </th>
                  <th scope="col">Last alert</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <CheckRow key={r.key} label={r.label} check={find(r.key)} nowMs={nowMs} />
                ))}
              </tbody>
            </table>
          </div>
          <dl className="admin-details admin-health-facts">
            <div className="admin-row">
              <dt className="admin-row-label">Alerts</dt>
              <dd className="admin-row-value">{report.alertsStarted ? <Badge tone="success">Running</Badge> : <Badge tone="attention">Not started: check the Telegram chat ID</Badge>}</dd>
            </div>
            <div className="admin-row">
              <dt className="admin-row-label">Last block read</dt>
              <dd className="admin-row-value">{lastBlock ?? <span className="admin-muted">None yet</span>}</dd>
            </div>
            <div className="admin-row">
              <dt className="admin-row-label">Chain head seen</dt>
              <dd className="admin-row-value">{report.rpcHead ?? <span className="admin-muted">None yet</span>}</dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  )
}
