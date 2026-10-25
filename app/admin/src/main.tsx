import { StrictMode, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import './admin.css'
import { AdminApp } from './AdminApp'
import { type AdminSession, getSession } from './lib/api'

// The Worker serves this page only with a session, so null here means the session ended since: back to the login page.
const queryClient = new QueryClient()

function Root() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    getSession().then(
      (s) => (s ? setSession(s) : location.assign('/')),
      () => setFailed(true),
    )
  }, [])
  if (failed) return <p className="admin-note">Couldn't check your session. Reload the page to try again.</p>
  return session ? <AdminApp session={session} /> : null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
