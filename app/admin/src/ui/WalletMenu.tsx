import { Blockie } from '../../../src/components/Blockie'
import { shortAddress } from '../../../src/lib/names'
import { logout } from '../lib/api'
import { useNetwork, useSession } from '../lib/network'
import { ADMIN_NETWORKS } from '../lib/networks'
import { ChevronDownIcon } from './icons'
import { Menu } from './Menu'

// The owner wallet chip: blockie and short address, with copy, explorer and sign out. Failures go to onError, which
// the shell shows above the page.
export function WalletMenu({ onError }: { onError(text: string): void }) {
  const { address } = useSession()
  const { network } = useNetwork()

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      onError(`Couldn't copy. Your address is ${address}.`)
    }
  }

  async function signOut() {
    try {
      await logout()
      location.assign('/')
    } catch {
      onError("Couldn't sign out. Try again.")
    }
  }

  return (
    <Menu
      label={`Owner wallet ${shortAddress(address)}`}
      className="admin-wallet"
      trigger={
        <>
          <Blockie address={address} size={20} />
          <span className="admin-wallet-address">{shortAddress(address)}</span>
          <ChevronDownIcon />
        </>
      }
      items={[
        { label: 'Copy address', onSelect: () => void copy() },
        { label: 'View on explorer', href: `${ADMIN_NETWORKS[network].explorerUrl}/address/${address}`, onSelect: () => {} },
        { label: 'Sign out', onSelect: () => void signOut() },
      ]}
    />
  )
}
