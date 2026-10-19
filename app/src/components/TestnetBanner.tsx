import type { ArcNetwork } from '../deployConfig'
import './TestnetBanner.css'

// Shown on every page of a testnet build, so nobody mistakes test tokens for real money.
export function TestnetBanner({ network }: { network: ArcNetwork }) {
  if (network !== 'testnet') return null
  return (
    <p className="testnet-banner" role="note">
      Test network. Tokens here have no value.
    </p>
  )
}
