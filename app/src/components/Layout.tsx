import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { Link, NavLink, Outlet } from 'react-router'
import { PASSKEYS_ENABLED } from '../config'
import { PasskeyMenu } from './PasskeyLogin'

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function ConnectButton() {
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  return (
    <button type="button" className={isConnected ? 'btn btn-outline' : 'btn'} onClick={() => open()}>
      {isConnected && address ? shortAddress(address) : 'Connect wallet'}
    </button>
  )
}

export function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="header-logo" aria-label="Fundit home">
          <picture>
            <source srcSet="/images/fundit-logo-dark.svg" media="(prefers-color-scheme: dark)" />
            <img src="/images/fundit-logo.svg" alt="Fundit" width={139} height={32} />
          </picture>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/create">Start a fundraiser</NavLink>
          <NavLink to="/me">My page</NavLink>
        </nav>
        <div className="header-connect">
          {PASSKEYS_ENABLED && <PasskeyMenu />}
          <ConnectButton />
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>Fundit runs on Arc. Funds stay in an on-chain escrow that only the creator can withdraw.</span>
        <nav aria-label="Legal">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  )
}
