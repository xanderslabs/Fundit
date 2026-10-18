import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSTER_HEIGHT, POSTER_WIDTH, posterFilename, renderPoster, wrapLines } from './poster'
import type { QrMatrix } from './qr'

// Every character is 10 units wide, so a 100-unit line holds 10 characters.
const measure = (s: string) => [...s].length * 10

describe('wrapLines', () => {
  it('keeps a short title on one line', () => {
    expect(wrapLines('Clean water', 200, measure)).toEqual(['Clean water'])
  })

  it('breaks between words', () => {
    expect(wrapLines('Seeds and tools for the garden', 100, measure)).toEqual(['Seeds and', 'tools for', 'the garden'])
  })

  // The QR code sits below the title, so a long title must stop at three lines, and show that it was cut.
  it('stops at three lines and ends the last with "..."', () => {
    const lines = wrapLines('one two three four five six seven eight nine ten', 100, measure)
    expect(lines).toHaveLength(3)
    expect(lines[2]!.endsWith('...')).toBe(true)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100)
  })

  it('splits a single word wider than the line', () => {
    const lines = wrapLines('abcdefghijklmnopqrstuvwxyz', 100, measure)
    expect(lines[0]).toBe('abcdefghij')
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100)
  })

  it('never splits an emoji in half', () => {
    const lines = wrapLines('💧💧💧💧💧💧💧💧💧💧💧💧', 50, measure)
    expect(lines.join('')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('posterFilename', () => {
  it('names the file after the short address', () => {
    expect(posterFilename('0xAbCd00000000000000000000000000000000Ef12')).toBe('fundit-0xabcdef12.png')
  })
})

describe('renderPoster', () => {
  afterEach(() => vi.restoreAllMocks())

  // jsdom has no canvas, so a recording 2D context stands in and toBlob returns a PNG blob.
  function fakeCanvas() {
    const texts: string[] = []
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn((t: string) => texts.push(t)),
      measureText: (s: string) => ({ width: [...s].length * 30 }),
    }
    let size = { w: 0, h: 0 }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      size = { w: this.width, h: this.height }
      return ctx as unknown as CanvasRenderingContext2D
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback, type?: string) =>
      cb(new Blob(['png'], { type })),
    )
    return { ctx, texts, size: () => size }
  }

  const qr: QrMatrix = { size: 21, isDark: (r, c) => (r + c) % 2 === 0 }

  it('draws a 1080 x 1350 PNG with the title, "Scan to give" and the short link', async () => {
    const { ctx, texts, size } = fakeCanvas()
    const blob = await renderPoster({ title: 'Clean water', url: 'https://fundit.xyz/c/0xabc', qr, logo: null })
    expect(size()).toEqual({ w: POSTER_WIDTH, h: POSTER_HEIGHT })
    expect([POSTER_WIDTH, POSTER_HEIGHT]).toEqual([1080, 1350])
    expect(blob.type).toBe('image/png')
    expect(texts).toEqual(['Clean water', 'Scan to give', 'fundit.xyz/c/0xabc'])
    // White background first, then one square per dark module.
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 1080, 1350])
    expect(ctx.fillRect).toHaveBeenCalledTimes(1 + Math.ceil((21 * 21) / 2))
  })

  it('draws the logo when it loaded', async () => {
    const { ctx } = fakeCanvas()
    const logo = new Image()
    await renderPoster({ title: 'x', url: 'https://fundit.xyz/c/0x1', qr, logo })
    expect(ctx.drawImage).toHaveBeenCalledWith(logo, expect.any(Number), expect.any(Number), 278, 64)
  })
})
