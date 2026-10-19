import { Link, Outlet } from 'react-router'
import { NETWORK_TAG, SOCIAL_LINKS } from '../config'
import { AccountControl } from './AccountMenu'
import { NetworkTag, networkTagName } from './NetworkTag'
import { ScrollToTop } from './ScrollToTop'
import { SocialIcon } from './SocialIcon'
import './Layout.css'

export function Layout() {
  return (
    <div className="layout">
      <ScrollToTop />
      <header className="header">
        <Link to="/" className="header-logo" aria-label={networkTagName('Fundit home', NETWORK_TAG)}>
          <img src="/images/fundit-logo.svg" alt="Fundit" width={139} height={32} />
          {NETWORK_TAG && <NetworkTag label={NETWORK_TAG} />}
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
                <SocialIcon name={s.name} />
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  )
}
