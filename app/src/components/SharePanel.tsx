import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from 'react'
import { createPoster, downloadBlob, posterFilename } from '../lib/poster'
import { qrMatrix, qrPath } from '../lib/qr'
import { embedSnippet, funditUrl, shareMessage, shareTargets } from '../lib/share'
import { Button } from './ui'
import './SharePanel.css'

type Props = { address: string; title: string; isCreator: boolean }

type CopyState = 'copied' | 'failed' | null

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// The QR code loads its encoder on first view. Drawn as one SVG path, so no HTML string is injected.
function ShareQr({ url }: { url: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null)
  useEffect(() => {
    let live = true
    qrMatrix(url).then(
      (m) => live && setQr({ size: m.size + 8, path: qrPath(m) }),
      () => live && setQr(null),
    )
    return () => {
      live = false
    }
  }, [url])
  if (!qr) return <div className="share-qr share-qr-loading" aria-hidden="true" />
  return (
    <svg className="share-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code for the link to this Fundit">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#101928" />
    </svg>
  )
}

function PosterButton({ address, title, url }: { address: string; title: string; url: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  async function download() {
    setState('busy')
    try {
      downloadBlob(await createPoster(title, url), posterFilename(address))
      setState('idle')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={download} disabled={state === 'busy'}>
        {state === 'busy' ? 'Making poster...' : 'Download poster'}
      </Button>
      <span className="share-note" role="status">
        {state === 'failed' && 'Could not make the poster in this browser.'}
      </span>
    </>
  )
}

function EmbedCode({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState<CopyState>(null)
  const id = useId()
  return (
    <details className="share-embed">
      <summary>Embed on your site</summary>
      <p className="share-note">Paste this code into your web page to show a card with the progress and a Give button.</p>
      <label className="sr-only" htmlFor={id}>
        Embed code
      </label>
      <textarea id={id} className="share-code" readOnly rows={4} value={snippet} onFocus={(e) => e.currentTarget.select()} />
      <div className="share-row">
        <Button variant="secondary" onClick={async () => setCopied((await copyText(snippet)) ? 'copied' : 'failed')}>
          Copy code
        </Button>
        <span className="share-note" role="status">
          {copied === 'copied' && 'Code copied'}
          {copied === 'failed' && 'Select the code above and copy it.'}
        </span>
      </div>
    </details>
  )
}

// Every way to pass a Fundit on: the link, the phone's share sheet, share links for each network, a QR code with
// a printable poster, and an embed code.
export function SharePanel({ address, title, isCreator, headingId }: Props & { headingId?: string }) {
  const origin = window.location.origin
  const url = funditUrl(origin, address)
  const name = title.trim() || 'this Fundit'
  const message = shareMessage(name, url, isCreator)
  const [copied, setCopied] = useState<CopyState>(null)
  const canShare = typeof navigator.share === 'function'
  const linkId = useId()

  async function copyLink() {
    setCopied((await copyText(url)) ? 'copied' : 'failed')
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: name, text: message, url })
      return
    } catch (err) {
      // Closing the share sheet throws AbortError, which needs nothing. Any other failure falls back to copying.
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
    await copyLink()
  }

  return (
    <div className="share-panel">
      <h2 id={headingId} className="share-title">Share this Fundit</h2>
      <p className="share-message">{message}</p>

      <div className="share-row">
        <label className="sr-only" htmlFor={linkId}>
          Link to this Fundit
        </label>
        <input id={linkId} className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={copyLink}>Copy link</Button>
      </div>
      <p className="share-note" role="status">
        {copied === 'copied' && 'Link copied'}
        {copied === 'failed' && 'Select the link above and copy it.'}
      </p>

      {canShare && (
        <Button variant="secondary" className="share-native" onClick={nativeShare}>
          Share from this device
        </Button>
      )}

      <ul className="share-targets" aria-label="Share on a network">
        {shareTargets(name, url, isCreator).map((t) => (
          <li key={t.key}>
            <a
              className="share-target"
              href={t.href}
              aria-label={t.label}
              {...(t.href.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {t.name}
            </a>
          </li>
        ))}
      </ul>

      <div className="share-poster">
        <div className="share-ticket">
          <img src="/images/fundit-logo.svg" alt="" width={84} height={19} />
          <ShareQr url={url} />
          <span>Scan to give</span>
        </div>
        <div className="share-poster-text">
          <p>Print it or post it. The poster has the title, this QR code and the link.</p>
          <PosterButton address={address} title={name} url={url} />
        </div>
      </div>

      <EmbedCode snippet={embedSnippet(origin, address, name)} />
    </div>
  )
}

// A Share button that opens the panel in a modal dialog. The native dialog keeps focus inside and closes on
// Escape; focus goes back to the button when it closes.
export function ShareDialog(props: Props) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    const d = dialog.current
    if (!open || !d || d.open) return
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
    closeButton.current?.focus()
  }, [open])

  function close() {
    const d = dialog.current
    if (d?.open && typeof d.close === 'function') d.close()
    else d?.removeAttribute('open')
    setOpen(false)
    trigger.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    close()
  }

  // A click on the backdrop lands on the dialog element itself.
  function onClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialog.current) close()
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        aria-haspopup="dialog"
        aria-label={`Share ${props.title.trim() || 'this Fundit'}`}
        onClick={() => setOpen(true)}
      >
        Share
      </Button>
      {open && (
        <dialog ref={dialog} className="share-dialog" aria-labelledby={headingId} onKeyDown={onKeyDown} onClick={onClick} onClose={close}>
          <div className="share-dialog-body">
            <button ref={closeButton} type="button" className="share-close" aria-label="Close" onClick={close}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <SharePanel {...props} headingId={headingId} />
          </div>
        </dialog>
      )}
    </>
  )
}
