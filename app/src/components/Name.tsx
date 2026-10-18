import type { Address } from 'viem'
import { EXPLORER_URL } from '../config'
import { useName } from '../hooks/useName'
import { shortAddress } from '../lib/names'

type Props = {
  address: Address
  // Off inside another link or a button, where a nested link is not allowed.
  link?: boolean
  avatar?: boolean
}

// The ENS name, else the Basename, else the short address. The full address is in the tooltip.
export function Name({ address, link = true, avatar = true }: Props) {
  const { data } = useName(address)
  const label = data?.name ?? shortAddress(address)
  const content = (
    <>
      {avatar && data?.avatar && (
        <img className="name-avatar" src={data.avatar} alt="" width={20} height={20} referrerPolicy="no-referrer" loading="lazy" />
      )}
      <span className="name-text">{label}</span>
    </>
  )
  if (!link) {
    return (
      <span className="name" title={address}>
        {content}
      </span>
    )
  }
  return (
    <a className="name" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer" title={address}>
      {content}
    </a>
  )
}
