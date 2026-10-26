import { type ComponentType, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router'
import { Dialog } from '../../../src/components/ui'
import type { AdminSession } from '../lib/api'
import { pickNetwork, readStoredNetwork, storeNetwork, useSession, withNetwork } from '../lib/network'
import type { AdminNetwork } from '../lib/networks'
import type { PanelPath } from '../lib/panelPaths'
import { ScanProvider } from '../scan/ScanProvider'
import { ActivityIcon, FunditsIcon, GiftsIcon, HealthIcon, MenuIcon, OverviewIcon, SettingsIcon } from './icons'
import { Logo } from './Logo'
import { NetworkSwitch } from './NetworkSwitch'
import { ThemeToggle } from './ThemeToggle'
import { WalletMenu } from './WalletMenu'

const NAV: { path: PanelPath; label: string; Icon: ComponentType }[] = [
  { path: '/', label: 'Overview', Icon: OverviewIcon },
  { path: '/fundits', label: 'Fundits', Icon: FunditsIcon },
  { path: '/gifts', label: 'Gifts', Icon: GiftsIcon },
  { path: '/activity', label: 'Activity', Icon: ActivityIcon },
  { path: '/health', label: 'Health', Icon: HealthIcon },
  { path: '/settings', label: 'Settings', Icon: SettingsIcon },
]

// What every page gets from the shell.
export type PanelContext = { session: AdminSession; network: AdminNetwork; showTest: boolean }

export function usePanel(): PanelContext {
  return useOutletContext<PanelContext>()
}

function Nav({ network, onNavigate }: { network: AdminNetwork; onNavigate?(): void }) {
  // Links keep the network, so moving between pages never switches it.
  const search = network === 'testnet' ? '?network=testnet' : ''
  return (
    <nav aria-label="Panel">
      <ul className="admin-nav">
        {NAV.map(({ path, label, Icon }) => (
          <li key={path}>
            <NavLink to={{ pathname: path, search }} end className="admin-nav-link" title={label} onClick={onNavigate}>
              <Icon />
              <span className="admin-nav-label">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// The panel frame: the testnet banner, a sidebar (icons only below 1024px, a sheet behind the menu button below
// 640px), the top bar with the page title and the network, test data, theme and wallet controls, and the page.
export function Shell() {
  const session = useSession()
  const [params] = useSearchParams()
  const network = pickNetwork(`?${params.toString()}`, readStoredNetwork(), session)
  if (!network) return <p className="admin-note admin-fatal">Couldn't check your session. Reload the page to try again.</p>
  return <Frame session={session} network={network} />
}

function Frame({ session, network }: { session: AdminSession; network: AdminNetwork }) {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  // Stats leave out test Fundits and test donors until this is on.
  const [showTest, setShowTest] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  const title = NAV.find((n) => n.path === path)?.label ?? 'Overview'

  // The URL and this browser always say which network is shown, whichever way it was picked.
  useEffect(() => {
    storeNetwork(network)
    const want = withNetwork(params, network)
    if (want.toString() !== params.toString()) setParams(want, { replace: true })
  }, [network, params, setParams])

  useEffect(() => {
    document.title = `${title} | Fundit admin`
  }, [title])

  return (
    <div className="admin-app">
      {network === 'testnet' && <p className="admin-testnet">Testnet. Nothing here is real money.</p>}
      <div className="admin-frame">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-logo">
            <Logo />
          </div>
          <Nav network={network} />
        </aside>
        <div className="admin-content">
          <header className="admin-topbar">
            <button type="button" className="admin-icon-button admin-sheet-button" aria-label="Open menu" onClick={() => setSheet(true)}>
              <MenuIcon />
            </button>
            <h1 className="admin-title">{title}</h1>
            <div className="admin-controls">
              <NetworkSwitch />
              <label className="admin-toggle">
                <input type="checkbox" role="switch" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
                Show test data
              </label>
              <ThemeToggle />
            </div>
            <WalletMenu onError={setError} />
          </header>
          <main className="admin-main">
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            {/* One history scan per network, kept while the owner moves between pages. */}
            <ScanProvider key={network} session={session} network={network}>
              <Outlet context={{ session, network, showTest } satisfies PanelContext} />
            </ScanProvider>
          </main>
        </div>
      </div>
      <Dialog open={sheet} onClose={() => setSheet(false)} title="Fundit admin" size="sm" placement="left">
        <Nav network={network} onNavigate={() => setSheet(false)} />
      </Dialog>
    </div>
  )
}
