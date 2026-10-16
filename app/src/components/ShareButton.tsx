import { useState } from 'react'

type Props = { url: string; title: string }

// The phone's share sheet when the browser has one, otherwise copies the link. X and Telegram links work everywhere.
export function ShareButton({ url, title }: Props) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const text = encodeURIComponent(title)
  const link = encodeURIComponent(url)

  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
      } catch {
        // Closing the share sheet throws. Nothing to do.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="share">
      <button type="button" className="btn btn-outline" onClick={share}>
        Share
      </button>
      <a className="share-link" href={`https://x.com/intent/tweet?text=${text}&url=${link}`} target="_blank" rel="noopener noreferrer">
        Post on X
      </a>
      <a className="share-link" href={`https://t.me/share/url?url=${link}&text=${text}`} target="_blank" rel="noopener noreferrer">
        Telegram
      </a>
      <span className="muted" role="status">
        {copied === 'yes' && 'Link copied.'}
        {copied === 'failed' && `Copy this link: ${url}`}
      </span>
    </div>
  )
}
