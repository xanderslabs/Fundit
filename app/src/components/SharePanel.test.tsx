import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog, SharePanel } from './SharePanel'

const ADDRESS = '0x00000000000000000000000000000000000000a1'
const URL_ = `${window.location.origin}/c/${ADDRESS}`

const poster = vi.hoisted(() => ({
  createPoster: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  downloadBlob: vi.fn(),
}))
vi.mock('../lib/poster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/poster')>()),
  createPoster: poster.createPoster,
  downloadBlob: poster.downloadBlob,
}))

let writeText: ReturnType<typeof vi.fn>

function setNavigator(share: ((data: ShareData) => Promise<void>) | undefined, clipboardWorks = true) {
  writeText = vi.fn(async () => {
    if (!clipboardWorks) throw new Error('denied')
  })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

beforeEach(() => setNavigator(undefined))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SharePanel', () => {
  it('copies the canonical link and says so', async () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(URL_)
    expect(await screen.findByText('Link copied')).toBeTruthy()
  })

  // Without clipboard access the person can still select the link in the field.
  it('points to the link field when the clipboard is blocked', async () => {
    setNavigator(undefined, false)
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText('Select the link above and copy it.')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Link to this Fundit' }) as HTMLInputElement).value).toBe(URL_)
  })

  // Desktop browsers often have no share sheet. Copy link is then the way to share, with no dead button.
  it('hides the device share button when navigator.share is missing', () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    expect(screen.queryByRole('button', { name: 'Share from this device' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('opens the share sheet with the message and link when the browser has one', async () => {
    const share = vi.fn(async () => {})
    setNavigator(share)
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(share).toHaveBeenCalledWith({
      title: 'Clean water',
      text: `Give to "Clean water" on Fundit: ${URL_}`,
      url: URL_,
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  // Some browsers have navigator.share but refuse it (no user gesture, blocked by policy). The link still gets
  // copied, so the person is not left with nothing.
  it('copies the link when the share sheet is refused', async () => {
    setNavigator(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')))
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(writeText).toHaveBeenCalledWith(URL_)
    expect(await screen.findByText('Link copied')).toBeTruthy()
  })

  // Closing the share sheet is a choice, not an error, so nothing else happens.
  it('does nothing when the person closes the share sheet', async () => {
    setNavigator(() => Promise.reject(new DOMException('Cancelled', 'AbortError')))
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Share from this device' }))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('shows the visitor message, or the organiser message for the organiser', () => {
    const { rerender } = render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    expect(screen.getByText(`Give to "Clean water" on Fundit: ${URL_}`)).toBeTruthy()
    rerender(<SharePanel address={ADDRESS} title="Clean water" isCreator />)
    expect(screen.getByText(`I started a Fundit: "Clean water". Every gift helps: ${URL_}`)).toBeTruthy()
  })

  // A share link that opens in the same tab takes the person away from the Fundit, and without noopener the
  // other site could reach back into this page.
  it('labels each network link and opens web links in a new tab with noopener noreferrer', () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    const list = screen.getByRole('list', { name: 'Share on a network' })
    const links = within(list).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Share on X',
      'Share on WhatsApp',
      'Share on Telegram',
      'Share on Facebook',
      'Share on LinkedIn',
      'Share on Reddit',
      'Share by email',
      'Share by text message',
    ])
    for (const a of links) {
      if (a.getAttribute('href')!.startsWith('https://')) {
        expect(a.getAttribute('target')).toBe('_blank')
        expect(a.getAttribute('rel')).toBe('noopener noreferrer')
      }
    }
  })

  it('renders a hostile title as text', () => {
    const { container } = render(<SharePanel address={ADDRESS} title="<img src=x onerror=alert(1)>" isCreator={false} />)
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByText(/^Give to "<img src=x onerror=alert\(1\)>" on Fundit/)).toBeTruthy()
  })

  it('shows a QR code of the link', async () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    const qr = await screen.findByRole('img', { name: 'QR code for the link to this Fundit' })
    expect(qr.querySelector('path')!.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/)
  })

  it('downloads the poster as fundit-<short address>.png', async () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download poster' }))
    await waitFor(() => expect(poster.downloadBlob).toHaveBeenCalled())
    expect(poster.createPoster).toHaveBeenCalledWith('Clean water', URL_)
    const [blob, name] = poster.downloadBlob.mock.calls[0] as unknown as [Blob, string]
    expect(blob.type).toBe('image/png')
    expect(name).toBe('fundit-0x000000a1.png')
  })

  it('says so when the poster cannot be made', async () => {
    poster.createPoster.mockRejectedValueOnce(new Error('no canvas'))
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download poster' }))
    expect(await screen.findByText('Could not make the poster in this browser.')).toBeTruthy()
  })

  it('offers the embed code and copies it', async () => {
    render(<SharePanel address={ADDRESS} title="Clean water" isCreator={false} />)
    await userEvent.click(screen.getByText('Embed on your site'))
    const code = screen.getByLabelText('Embed code') as HTMLTextAreaElement
    expect(code.value).toContain(`src="${window.location.origin}/embed/c/${ADDRESS}"`)
    expect(code.value).toContain('title="Clean water on Fundit"')
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith(code.value)
    expect(await screen.findByText('Code copied')).toBeTruthy()
  })
})

describe('ShareDialog', () => {
  it('opens the panel in a dialog, moves focus in, and returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<ShareDialog address={ADDRESS} title="Clean water" isCreator />)
    const trigger = screen.getByRole('button', { name: 'Share Clean water' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Share this Fundit' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes with the Close button', async () => {
    const user = userEvent.setup()
    render(<ShareDialog address={ADDRESS} title="Clean water" isCreator />)
    await user.click(screen.getByRole('button', { name: 'Share Clean water' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share Clean water' }))
  })
})
