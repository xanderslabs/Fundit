import { useQueries } from '@tanstack/react-query'
import type { Address } from 'viem'
import { type ChainState, chainBalanceKey, readWithTimeout, summarize, usdcSources } from '../lib/chainBalances'
import { formatAmount } from '../lib/format'
import { Card } from './ui'
import './ChainBalances.css'

const SOURCES = usdcSources()
// Balances on other networks change only when the person moves money, so a minute between reads is enough.
const STALE_MS = 60_000

const value = (row: ChainState) => (row.status === 'ok' ? formatAmount(row.amount, 'USDC') : row.status === 'failed' ? "Couldn't check" : 'Checking...')

// The account's USDC on Arc and on each CCTP network. Every network is its own query, so each row shows as soon as
// it answers and a failed one never holds up the rest.
export function ChainBalances({ account }: { account: Address }) {
  const results = useQueries({
    queries: SOURCES.map((s) => ({
      queryKey: chainBalanceKey(s.key, account),
      queryFn: () => readWithTimeout(s, account),
      staleTime: STALE_MS,
      retry: false,
    })),
  })
  const states = results.map((q): ChainState => (q.isSuccess ? { status: 'ok', amount: q.data } : q.isError ? { status: 'failed' } : { status: 'pending' }))
  const { rows, total, answered, failed, pending } = summarize(SOURCES, states)
  return (
    <Card className="chain-balances">
      <h2 className="chain-balances-title">Your USDC on every network</h2>
      <dl className="chain-balances-list" aria-live="polite">
        {rows.map((row) => (
          <div key={row.key} className="chain-balances-row">
            <dt>{row.label}</dt>
            <dd className={row.status === 'ok' ? undefined : 'chain-balances-muted'}>{value(row)}</dd>
          </div>
        ))}
        <div className="chain-balances-row chain-balances-total">
          <dt>Total</dt>
          <dd>{answered > 0 ? formatAmount(total, 'USDC') : pending > 0 ? 'Checking...' : "Couldn't check"}</dd>
        </div>
      </dl>
      {failed > 0 && answered > 0 && (
        <p className="chain-balances-note">
          The total leaves out {failed === 1 ? 'the network' : `the ${failed} networks`} we couldn't check.
        </p>
      )}
      <p className="chain-balances-note">Gifts use your Arc balance today. Giving straight from other networks is coming next.</p>
    </Card>
  )
}
