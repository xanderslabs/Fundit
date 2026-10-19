import type { NetworkTagLabel } from '../config'
import './NetworkTag.css'

// The small tag at the top right of the Fundit logo: "Testnet" on testnet, "Beta" on mainnet while VITE_BETA=1.
// It is part of the logo link's name (see networkTagName), so it is hidden from the accessibility tree here.
export function NetworkTag({ label, size = 'md' }: { label: NetworkTagLabel; size?: 'sm' | 'md' }) {
  return (
    <span className={`network-tag network-tag-${label.toLowerCase()} network-tag-${size}`} aria-hidden="true">
      {label}
    </span>
  )
}

// The logo link's accessible name with the tag in it, such as "Fundit home, testnet".
export function networkTagName(name: string, label: NetworkTagLabel | null): string {
  return label ? `${name}, ${label.toLowerCase()}` : name
}
