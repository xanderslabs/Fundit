import { useCallback, useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { NetworkTag, networkTagName } from '../components/NetworkTag'
import { Progress } from '../components/Progress'
import { campaignStatus, StatusBadge } from '../components/StatusBadge'
import { NETWORK_TAG } from '../config'
import { type CampaignView, fetchCampaign, type ReadClient } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { formatAmount } from '../lib/format'
// The embed has no router, so it styles plain links and buttons with the ui button classes.
import '../components/ui/Button.css'

type State = { kind: 'loading' } | { kind: 'ready'; view: CampaignView } | { kind: 'not-a-fundit' } | { kind: 'error' }

type Props = { address: string; origin: string; client?: ReadClient }

// The card other sites show in an iframe. It reads the Fundit with the plain Arc read client only: no wallet
// code, no header or footer. The Give link opens the Fundit page in a new tab, where the wallet is.
export function Embed({ address, origin, client = arcClient }: Props) {
  const valid = isAddress(address)
  const [state, setState] = useState<State>(valid ? { kind: 'loading' } : { kind: 'not-a-fundit' })

  const load = useCallback(() => {
    if (!isAddress(address)) return () => {}
    let live = true
    setState({ kind: 'loading' })
    fetchCampaign(client, address).then(
      (r) => live && setState(r === 'not-a-campaign' ? { kind: 'not-a-fundit' } : { kind: 'ready', view: r }),
      () => live && setState({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [address, client])

  useEffect(load, [load])

  useEffect(() => {
    if (state.kind === 'ready') document.title = `${state.view.summary.meta.title || 'A Fundit'} on Fundit`
  }, [state])

  if (state.kind === 'not-a-fundit') {
    return (
      <main className="embed embed-notice">
        <Logo origin={origin} />
        <p className="embed-title">Not a Fundit</p>
        <p className="embed-muted">This address was not created by the Fundit factory.</p>
      </main>
    )
  }
  if (state.kind === 'error') {
    return (
      <main className="embed embed-notice">
        <Logo origin={origin} />
        <p className="embed-muted">Could not load this Fundit. The Arc network did not answer.</p>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-md embed-retry" onClick={load}>
          Try again
        </button>
      </main>
    )
  }
  if (state.kind === 'loading') {
    return (
      <main className="embed embed-notice" aria-busy="true">
        <Logo origin={origin} />
        <p className="embed-muted">Loading...</p>
      </main>
    )
  }

  const { summary, symbol } = state.view
  const status = campaignStatus(summary)
  const href = `${origin}/c/${state.view.address}`
  return (
    <main className="embed">
      <div className="embed-top">
        <Logo origin={origin} />
        {status !== 'Open' && <StatusBadge summary={summary} />}
      </div>
      <p className="embed-title">{summary.meta.title || 'Untitled Fundit'}</p>
      <div className="embed-progress">
        <p className="embed-amounts">
          <strong>{formatAmount(summary.raised, symbol)}</strong> raised of {formatAmount(summary.goal, symbol)}
        </p>
        <Progress raised={summary.raised} goal={summary.goal} />
      </div>
      {summary.closed ? (
        <div className="embed-foot">
          <span className="embed-muted">This Fundit is closed.</span>
          <a className="embed-link" href={href} target="_blank" rel="noopener">
            See it on Fundit
          </a>
        </div>
      ) : (
        <div className="embed-foot">
          <span className="embed-muted">{symbol} on Arc</span>
          <a className="ui-btn ui-btn-primary ui-btn-md embed-give" href={href} target="_blank" rel="noopener">
            Give
          </a>
        </div>
      )}
    </main>
  )
}

function Logo({ origin }: { origin: string }) {
  return (
    <a className="embed-logo" href={origin} target="_blank" rel="noopener" aria-label={networkTagName('Fundit', NETWORK_TAG)}>
      <img src="/images/fundit-logo.svg" alt="Fundit" width={83} height={19} />
      {NETWORK_TAG && <NetworkTag label={NETWORK_TAG} size="sm" />}
    </a>
  )
}
