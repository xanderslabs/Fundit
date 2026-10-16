import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShareButton } from './ShareButton'

const URL = 'https://fundit.fun/c/0x00000000000000000000000000000000000000a1'

function setNavigator(share: (() => Promise<void>) | undefined) {
  const writeText = vi.fn(async (_: string) => {})
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(cleanup)

describe('ShareButton', () => {
  // Some browsers have navigator.share but refuse it (no user gesture, blocked by policy). The person
  // still needs a way to share, so the link gets copied.
  it('copies the link when the share sheet fails for a reason other than being closed', async () => {
    const writeText = setNavigator(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')))
    render(<ShareButton url={URL} title="Clean water" />)
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(writeText).toHaveBeenCalledWith(URL)
    expect(await screen.findByText('Link copied.')).toBeTruthy()
  })

  // Closing the share sheet is a choice, not an error, so nothing else happens.
  it('does nothing when the person closes the share sheet', async () => {
    const writeText = setNavigator(() => Promise.reject(new DOMException('Cancelled', 'AbortError')))
    render(<ShareButton url={URL} title="Clean water" />)
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('builds X and Telegram links with the URL and title encoded', () => {
    setNavigator(undefined)
    render(<ShareButton url={URL} title="Water & wells" />)
    expect(screen.getByRole('link', { name: 'Post on X' }).getAttribute('href')).toBe(
      `https://x.com/intent/tweet?text=Water%20%26%20wells&url=${encodeURIComponent(URL)}`,
    )
  })
})
