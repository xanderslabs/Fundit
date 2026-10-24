import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { ErrorBoundary } from './components/ErrorBoundary'
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

// Development only. A production build replaces import.meta.env.DEV with false, so this import and the route are
// dropped and the style guide is not in the bundle.
const StyleGuide = import.meta.env.DEV ? lazy(() => import('./pages/StyleGuide').then((m) => ({ default: m.StyleGuide }))) : null

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explore" element={<Explore />} />
        <Route path="c/:address" element={<CampaignPage />} />
        <Route path="create" element={<Create />} />
        <Route path="manage/:address" element={<Manage />} />
        <Route path="me" element={<Profile />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        {import.meta.env.DEV && StyleGuide && (
          <Route
            path="styleguide"
            element={
              <ErrorBoundary>
                <Suspense fallback={<p className="main-loading">Loading...</p>}>
                  <StyleGuide />
                </Suspense>
              </ErrorBoundary>
            }
          />
        )}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
