import { Link, Outlet } from 'react-router'
import { SOCIAL_LINKS } from '../config'
import { AccountControl } from './AccountMenu'

export function Layout() {
  return (
    <div className="layout">
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
