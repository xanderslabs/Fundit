import { cleanup, render, screen } from '@testing-library/react'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { ReadClient, Summary } from '../lib/campaigns'
import { Embed } from './Embed'

// The embed page must not load wallet code. If anything on its import graph pulls wagmi or AppKit in, these
// factories throw and the import fails.
vi.mock('wagmi', () => {
  throw new Error('the embed page loaded wagmi')
})
vi.mock('@reown/appkit/react', () => {
  throw new Error('the embed page loaded AppKit')
})

const ADDRESS = '0x00000000000000000000000000000000000000a1' as Address
const ORIGIN = 'https://fundit.xyz'

function summary(over: Partial<Summary> = {}, title = 'Clean water'): Summary {
  return {
    creator: '0x1111111111111111111111111111111111111111',
    token: TOKENS.USDC.address,
    goal: 1000000000n,
    raised: 250000000n,
    available: 250000000n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 100,
    withdrawFeeBps: 100,
    createdAt: 1760000000n,
    createdAtBlock: 1n,
    backup: '0x0000000000000000000000000000000000000000',
    recoveryReadyAt: 0n,
    meta: { title, description: '', imageUrl: 'https://img.example/x.png', links: [] },
    ...over,
  } as Summary
}

function client(known: boolean, s: Summary = summary()): ReadClient {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => (functionName === 'isCampaign' ? known : s)),
    multicall: vi.fn(),
  } as unknown as ReadClient
}

afterEach(cleanup)

describe('Embed', () => {
  // Rendered with no WagmiProvider, QueryClientProvider or router: the card works on its own.
  it('shows the title, progress and a Give link that opens the Fundit in a new tab', async () => {
    render(<Embed address={ADDRESS} origin={ORIGIN} client={client(true)} />)
    expect(await screen.findByText('Clean water')).toBeTruthy()
    expect(screen.getByText('250.00 USDC')).toBeTruthy()
    expect(screen.getByText(/raised of 1,000\.00 USDC/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByText('USDC on Arc')).toBeTruthy()
    const give = screen.getByRole('link', { name: 'Give' })
    expect(give.getAttribute('href')).toBe(`${ORIGIN}/c/${ADDRESS}`)
    expect(give.getAttribute('target')).toBe('_blank')
    expect(give.getAttribute('rel')).toBe('noopener')
  })

  // The cover image can come from any host, so the card never shows it.
  it('shows no image from the Fundit data', async () => {
    const { container } = render(<Embed address={ADDRESS} origin={ORIGIN} client={client(true)} />)
    await screen.findByText('Clean water')
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['/images/fundit-logo.svg'])
  })

  it('renders a hostile title as text', async () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const { container } = render(<Embed address={ADDRESS} origin={ORIGIN} client={client(true, summary({}, hostile))} />)
    expect(await screen.findByText(hostile)).toBeTruthy()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it('says when the Fundit is closed and offers no Give link', async () => {
    render(<Embed address={ADDRESS} origin={ORIGIN} client={client(true, summary({ closed: true }))} />)
    expect(await screen.findByText('This Fundit is closed.')).toBeTruthy()
    expect(screen.getByText('Closed')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Give' })).toBeNull()
    expect(screen.getByRole('link', { name: 'See it on Fundit' }).getAttribute('href')).toBe(`${ORIGIN}/c/${ADDRESS}`)
  })

  // A clone with a hostile creator is not a Fundit, so its title and numbers are never shown.
  it("shows 'Not a Fundit' for an address the factory does not know", async () => {
    const c = client(false)
    render(<Embed address={ADDRESS} origin={ORIGIN} client={c} />)
    expect(await screen.findByText('Not a Fundit')).toBeTruthy()
    expect(screen.queryByText('Clean water')).toBeNull()
    expect(c.readContract).toHaveBeenCalledTimes(1)
  })

  it("shows 'Not a Fundit' for a path that is not an address, without reading the chain", () => {
    const c = client(true)
    render(<Embed address="not-an-address" origin={ORIGIN} client={c} />)
    expect(screen.getByText('Not a Fundit')).toBeTruthy()
    expect(c.readContract).not.toHaveBeenCalled()
  })

  it('offers Try again when Arc does not answer', async () => {
    const c = { readContract: vi.fn().mockRejectedValueOnce(new Error('down')), multicall: vi.fn() } as unknown as ReadClient
    render(<Embed address={ADDRESS} origin={ORIGIN} client={c} />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('embed entry', () => {
  it('mounts without loading wagmi or AppKit', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    await import('../embed')
    expect(await screen.findByText('Not a Fundit')).toBeTruthy()
  })
})
