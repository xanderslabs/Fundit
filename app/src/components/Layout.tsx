import { Link, Outlet } from 'react-router'
import { NETWORK, SOCIAL_LINKS } from '../config'
import type { ArcNetwork } from '../deployConfig'
import { AccountControl } from './AccountMenu'

// Shown on every page of a testnet build, so nobody mistakes test tokens for real money.
export function TestnetBanner({ network }: { network: ArcNetwork }) {
  if (network !== 'testnet') return null
  return (
    <p className="testnet-banner" role="note">
      Test network. Tokens here have no value.
    </p>
  )
}

export function Layout() {
  return (
    <div className="layout">
      <TestnetBanner network={NETWORK.name} />
      <header className="header">
        <Link to="/" className="header-logo" aria-label="Fundit home">
          <img src="/images/fundit-logo.svg" alt="Fundit" width={139} height={32} />
        </Link>
        <AccountControl />
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <nav className="footer-links" aria-label="Legal">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
        <ul className="socials" aria-label="Fundit on social media">
          {SOCIAL_LINKS.map((s) => (
            <li key={s.name}>
              <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`Fundit on ${s.name}`}>
                <img src={s.icon} alt="" width={36} height={36} loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  )
}
