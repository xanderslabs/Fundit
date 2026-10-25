import { useState } from 'react'
import { AddressChip, Button, PageHeader } from '../../src/components/ui'
import { type AdminSession, logout } from './lib/api'

const NETWORK_NAME = { testnet: 'Arc Testnet', mainnet: 'Arc Mainnet' } as const

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

  return (
    <div className="admin-shell">
      <PageHeader
        title="Fundit admin"
        width="wide"
        subtitle={
          <>
            {NETWORK_NAME[session.network]}
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
      </main>
    </div>
  )
}
