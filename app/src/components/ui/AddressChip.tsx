import { useState } from 'react'
import type { Address } from 'viem'
import { EXPLORER_URL } from '../../config'
import { shortAddress } from '../../lib/names'
import './AddressChip.css'

// The short address (0x1234...abcd) with a Copy button and an optional explorer link. The full address is always
// what is copied, and it shows on hover.
export function AddressChip({ address, explorer = false }: { address: Address; explorer?: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <span className="ui-address">
      <span className="ui-address-row">
        <code className="ui-address-text" title={address}>
          {shortAddress(address)}
        </code>
        {/* The name says what is copied; the box only has room for "Copy". */}
        <button type="button" className="ui-address-copy" onClick={() => void copy()}>
          {copied ? (
            'Copied'
          ) : (
            <>
              {'Copy '}
              <span className="ui-address-hidden">address</span>
            </>
          )}
        </button>
        {explorer && (
          <a className="ui-address-link" href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
            View on explorer
          </a>
        )}
      </span>
      {copied === false && (
        <span className="ui-address-error" role="alert">
          Could not copy. Select the address and copy it yourself.
        </span>
      )}
    </span>
  )
}
