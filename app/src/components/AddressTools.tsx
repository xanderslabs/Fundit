import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { shortAddress } from '../lib/names'
import { qrMatrix, qrPath } from '../lib/qr'

// A QR code for an address, drawn as SVG squares so no HTML string is injected.
export function AddressQr({ address, label }: { address: Address; label: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null)
  useEffect(() => {
    let live = true
    void qrMatrix(address).then((m) => live && setQr({ size: m.size + 8, path: qrPath(m) }))
    return () => {
      live = false
    }
  }, [address])
  if (!qr) return null
  return (
    <svg className="fund-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label}>
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#101928" />
    </svg>
  )
}

// short shows 0x1234...abcd with a Copy button (the balance card). The full address is always what is copied.
export function CopyAddress({ address, short = false }: { address: Address; short?: boolean }) {
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
    <div className={short ? 'fund-address fund-address-short' : 'fund-address'}>
      <code title={short ? address : undefined}>{short ? shortAddress(address) : address}</code>
      <button type="button" className="btn btn-outline" onClick={() => void copy()}>
        {copied ? 'Copied' : short ? 'Copy' : 'Copy address'}
      </button>
      {copied === false && <p className="field-error">Could not copy. Select the address and copy it yourself.</p>}
    </div>
  )
}
