import { useEffect, useRef, useState } from 'react'
import type { Address as Hex } from 'viem'
import { Blockie } from '../../../src/components/Blockie'
import { shortAddress } from '../../../src/lib/names'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { CopyIcon, ExternalLinkIcon } from './icons'

// One address display for the whole panel: blockie, 0x1234...abcd, a copy button and a link to the selected
// network's explorer (the shared AddressChip only knows the public build's explorer). The full address is what is
// copied. If the clipboard is blocked, the full address shows selected, ready to copy by hand.
export function Address({ address, network, label }: { address: Hex; network: AdminNetwork; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const text = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (!manual || !text.current) return
    const range = document.createRange()
    range.selectNodeContents(text.current)
    const selection = getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [manual])

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setManual(true)
    }
  }

  const name = label ?? 'address'
  return (
    <span className="admin-address">
      <Blockie address={address} size={18} />
      <code ref={text} className="admin-address-text" title={address}>
        {manual ? address : shortAddress(address)}
      </code>
      <button type="button" className="admin-icon-button admin-icon-button-sm" aria-label={copied ? 'Copied' : `Copy ${name}`} onClick={() => void copy()}>
        {copied ? <span className="admin-address-copied">Copied</span> : <CopyIcon />}
      </button>
      <a
        className="admin-icon-button admin-icon-button-sm"
        href={`${ADMIN_NETWORKS[network].explorerUrl}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View ${name} on explorer`}
      >
        <ExternalLinkIcon />
      </a>
    </span>
  )
}
