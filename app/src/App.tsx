import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { PASSKEYS_ENABLED } from './config'
import { CampaignPage } from './pages/CampaignPage'
import { Create } from './pages/Create'
import { Explore } from './pages/Explore'
import { Home } from './pages/Home'
import { Manage } from './pages/Manage'

// Only passkey users need this page, so it loads on demand.
const FundWallet = lazy(() => import('./pages/FundWallet').then((m) => ({ default: m.FundWallet })))

// Placeholder until the page for this route is built in a later task.
function Stub({ title }: { title: string }) {
  return <h1>{title}</h1>
}

function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        This page does not exist. <Link to="/">Go to the home page</Link>.
      </p>
    </section>
  )
}

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
            path="fund"
            element={
              <Suspense fallback={<p className="muted">Loading...</p>}>
                <FundWallet />
              </Suspense>
            }
          />
        )}
        <Route path="me" element={<Stub title="My page" />} />
        <Route path="terms" element={<Stub title="Terms" />} />
        <Route path="privacy" element={<Stub title="Privacy" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
