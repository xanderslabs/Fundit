import { useNetwork, useSession } from '../lib/network'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { ChevronDownIcon } from './icons'
import { Menu } from './Menu'

const ORDER: AdminNetwork[] = ['mainnet', 'testnet']

// Arc Mainnet or Arc Testnet. A network whose factory the signed-in address does not own is shown but cannot be
// picked. Quiet on mainnet; orange on testnet, with the banner above the top bar.
export function NetworkSwitch() {
  const session = useSession()
  const { network, setNetwork } = useNetwork()
  const { label } = ADMIN_NETWORKS[network]
  return (
    <Menu
      label={`Network: ${label}`}
      className={`admin-network admin-network-${network}`}
      align="start"
      trigger={
        <>
          <span className="admin-network-dot" aria-hidden="true" />
          <span>{label}</span>
          <ChevronDownIcon />
        </>
      }
      items={ORDER.map((n) => {
        const owned = session.networks[n].owner === true
        return {
          label: ADMIN_NETWORKS[n].label,
          current: n === network,
          disabled: !owned,
          hint: owned ? undefined : 'Not the owner on this network',
          onSelect: () => setNetwork(n),
        }
      })}
    />
  )
}
