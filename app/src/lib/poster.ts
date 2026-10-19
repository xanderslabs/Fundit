import { type QrMatrix, qrMatrix } from './qr'

// A portrait poster for social posts and print: logo, title, a large QR code and the short link. The cover
// image is never drawn: it can come from any host, and a cross-origin image would taint the canvas.
export const POSTER_WIDTH = 1080
export const POSTER_HEIGHT = 1350

// A canvas cannot read CSS tokens, so the poster keeps the brand ink and muted colours as literals.
const INK = '#101928'
const MUTED = '#586283'
const MARGIN = 80
const TITLE_FONT = `800 64px Outfit, system-ui, sans-serif`
const TITLE_LINE = 76
const TITLE_TOP = 214
const QR_SIZE = 600
const QR_TOP = 470

// Word wrap to at most maxLines. A word longer than a line is split, and text that does not fit ends in "...".
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  const push = (l: string) => lines.push(l)
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) <= maxWidth) {
      line = next
      continue
    }
    if (line) push(line)
    // Split a single word that is wider than the line.
    let rest = word
    while (measure(rest) > maxWidth) {
      const chars = [...rest]
      let n = chars.length - 1
      while (n > 1 && measure(chars.slice(0, n).join('')) > maxWidth) n--
      push(chars.slice(0, n).join(''))
      rest = chars.slice(n).join('')
    }
    line = rest
  }
  if (line) push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = `${kept[maxLines - 1]}...`
  while (measure(last) > maxWidth && last.length > 3) last = `${[...last.slice(0, -3)].slice(0, -1).join('')}...`
  kept[maxLines - 1] = last
  return kept
}

// fundit-0x1234abcd.png: the start and end of the address, like the short address shown on the site.
export function posterFilename(address: string): string {
  const a = address.toLowerCase()
  return `fundit-${a.slice(0, 6)}${a.slice(-4)}.png`
}

export type PosterInput = { title: string; url: string; qr: QrMatrix; logo: CanvasImageSource | null }

export function drawPoster(ctx: CanvasRenderingContext2D, { title, url, qr, logo }: PosterInput) {
  const centre = POSTER_WIDTH / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  // The logo is drawn at its own size, 278 x 64.
  if (logo) ctx.drawImage(logo, centre - 139, 96, 278, 64)

  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = TITLE_FONT
  const lines = wrapLines(title, POSTER_WIDTH - MARGIN * 2, (s) => ctx.measureText(s).width)
  // Fewer lines sit in the middle of the three-line block, so the QR code never moves.
  const top = TITLE_TOP + ((3 - lines.length) * TITLE_LINE) / 2
  lines.forEach((l, i) => ctx.fillText(l, centre, top + TITLE_LINE * i + TITLE_LINE / 2))

  const modules = qr.size + 2
  const cell = Math.floor(QR_SIZE / modules)
  const qrSide = cell * modules
  // Whole pixels, so neighbouring modules meet without hairline seams.
  const x0 = Math.round(centre - qrSide / 2)
  const y0 = Math.round(QR_TOP + (QR_SIZE - qrSide) / 2)
  ctx.fillStyle = INK
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) if (qr.isDark(r, c)) ctx.fillRect(x0 + (c + 1) * cell, y0 + (r + 1) * cell, cell, cell)
  }

  ctx.font = `800 52px Outfit, system-ui, sans-serif`
  ctx.fillText('Scan to give', centre, QR_TOP + QR_SIZE + 70)

  const short = url.replace(/^https?:\/\//, '')
  let size = 34
  ctx.font = `500 ${size}px Outfit, system-ui, sans-serif`
  while (size > 18 && ctx.measureText(short).width > POSTER_WIDTH - MARGIN * 2) {
    size -= 2
    ctx.font = `500 ${size}px Outfit, system-ui, sans-serif`
  }
  ctx.fillStyle = MUTED
  ctx.fillText(short, centre, QR_TOP + QR_SIZE + 140)
}

export function renderPoster(input: PosterInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('This browser cannot draw the poster.'))
  drawPoster(ctx, input)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser cannot draw the poster.'))), 'image/png')
  })
}

// Our own logo, from our origin, so it never taints the canvas. The poster still works without it.
export function loadLogo(src = '/images/fundit-logo.svg'): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

// Loads the QR encoder, the logo and the brand font, then draws the poster.
export async function createPoster(title: string, url: string): Promise<Blob> {
  const [qr, logo] = await Promise.all([
    qrMatrix(url),
    loadLogo(),
    document.fonts?.load(TITLE_FONT).catch(() => undefined),
  ])
  return renderPoster({ title, url, qr, logo })
}
