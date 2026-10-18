import { useState } from 'react'
import { safeHttpsUrl } from '../lib/urls'
import './CampaignImage.css'

type Props = { url: string; title: string; className?: string }

// Shows the campaign image only for https URLs. Anything else, or a broken image, gets a plain brand tile.
export function CampaignImage({ url, title, className = '' }: Props) {
  const [broken, setBroken] = useState(false)
  const src = safeHttpsUrl(url)
  if (!src || broken) {
    return (
      <div className={`campaign-image campaign-image-empty ${className}`} aria-hidden="true">
        <span>{title.trim().charAt(0).toUpperCase() || 'F'}</span>
      </div>
    )
  }
  return (
    <img
      className={`campaign-image ${className}`}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}
