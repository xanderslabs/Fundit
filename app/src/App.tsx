import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { CampaignPage } from './pages/CampaignPage'
import { Create } from './pages/Create'
import { Explore } from './pages/Explore'
import { Home } from './pages/Home'
import { Manage } from './pages/Manage'
import { NotFound } from './pages/NotFound'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Terms } from './pages/Terms'

// Loaded on demand: most visits never open it.
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
        <Route
          path="recover"
          element={
            <Suspense fallback={<p className="muted">Loading...</p>}>
              <Recover />
            </Suspense>
          }
        />
        <Route path="me" element={<Profile />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
