import { type ComponentType, useState } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router'
import type { AdminSession } from './lib/api'
import { SessionContext } from './lib/network'
import { type PanelPath, PANEL_PATHS } from './lib/panelPaths'
import { ActivityPage } from './pages/ActivityPage'
import { FunditsPage } from './pages/FunditsPage'
import { GiftsPage } from './pages/GiftsPage'
import { HealthPage } from './pages/HealthPage'
import { OverviewPage } from './pages/OverviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { Shell } from './ui/Shell'

const PAGES: Record<PanelPath, ComponentType> = {
  '/': OverviewPage,
  '/fundits': FunditsPage,
  '/gifts': GiftsPage,
  '/activity': ActivityPage,
  '/health': HealthPage,
  '/settings': SettingsPage,
}

// Any other path goes to Overview, keeping the network in the query.
function ToOverview() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/', search }} replace />
}

function makeRouter() {
  return createBrowserRouter([
    {
      element: <Shell />,
      children: [
        ...PANEL_PATHS.map((path) => {
          const Page = PAGES[path]
          return path === '/' ? { index: true, element: <Page /> } : { path, element: <Page /> }
        }),
        { path: '*', element: <ToOverview /> },
      ],
    },
  ])
}

// The panel: one page per path, the same six paths the Worker serves it on.
export function AdminApp({ session }: { session: AdminSession }) {
  const [router] = useState(makeRouter)
  return (
    <SessionContext.Provider value={session}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  )
}
