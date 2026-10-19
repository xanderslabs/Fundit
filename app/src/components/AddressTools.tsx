import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { qrMatrix, qrPath } from '../lib/qr'
import './AddressTools.css'

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
