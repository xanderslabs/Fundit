import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { PASSKEYS_ENABLED } from './config'
import { CampaignPage } from './pages/CampaignPage'
import { Create } from './pages/Create'
import { Explore } from './pages/Explore'
import { Home } from './pages/Home'
import { Manage } from './pages/Manage'
import { NotFound } from './pages/NotFound'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Terms } from './pages/Terms'

// Only passkey users need this page, so it loads on demand.
const AddMoney = lazy(() => import('./pages/AddMoney').then((m) => ({ default: m.AddMoney })))
const Recover = lazy(() => import('./pages/Recover').then((m) => ({ default: m.Recover })))

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explore" element={<Explore />} />
        <Route path="c/:address" element={<CampaignPage />} />
        <Route path="create" element={<Create />} />
        <Route path="manage/:address" element={<Manage />} />
        {PASSKEYS_ENABLED && (
          <Route
            path="add-money"
            element={
              <Suspense fallback={<p className="muted">Loading...</p>}>
                <AddMoney />
              </Suspense>
            }
          />
        )}
        {/* The old address of the Add money page. */}
        {PASSKEYS_ENABLED && <Route path="fund" element={<Navigate to="/add-money" replace />} />}
        {PASSKEYS_ENABLED && (
          <Route
            path="recover"
            element={
              <Suspense fallback={<p className="muted">Loading...</p>}>
                <Recover />
              </Suspense>
            }
          />
        )}
        <Route path="me" element={<Profile />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
