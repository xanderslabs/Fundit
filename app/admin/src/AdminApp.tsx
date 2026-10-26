import { useState } from 'react'
import { AddressChip, Button, PageHeader } from '../../src/components/ui'
import { type AdminSession, logout, ownedNetwork } from './lib/api'
import { ADMIN_NETWORKS } from './lib/networks'
import { Gifts } from './Gifts'
import { Overview } from './Overview'
import { OwnerControls } from './OwnerControls'

// The panel shell. Later sections go inside <main>.
export function AdminApp({ session }: { session: AdminSession }) {
  // Stats leave out test Fundits and test donors until this is on.
  const [showTest, setShowTest] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOut() {
    try {
      await logout()
      location.assign('/')
    } catch {
      setError("Couldn't sign out. Try again.")
    }
  }

  // The current one-page panel shows one network: the first the session owns, mainnet first. The Worker answers a
  // session only when the address owns at least one, so null here means the answer is not usable.
  const network = ownedNetwork(session)
  if (!network) return <p className="admin-note">Couldn't check your session. Reload the page to try again.</p>

  return (
    <div className="admin-shell">
      <PageHeader
        title="Fundit admin"
        width="wide"
        subtitle={
          <>
            {ADMIN_NETWORKS[network].label}
            {' · Signed in as '}
            <AddressChip address={session.address} />
          </>
        }
        actions={
          <>
            <label className="admin-switch">
              <input type="checkbox" role="switch" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
              Show test data
            </label>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      />
      <main className="admin-main">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Overview session={session} network={network} showTest={showTest} />
        <Gifts session={session} network={network} showTest={showTest} />
        <OwnerControls session={session} network={network} />
      </main>
    </div>
  )
}
