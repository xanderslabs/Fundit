import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/tokens.css', 'utf8')

// The first :root block holds the tokens. Media queries only override a few of them.
const root = css.match(/(?:^|\n):root\s*\{([^}]*)\}/)?.[1] ?? ''
const tokens = new Map([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))

function value(name: string, seen: string[] = []): string {
  const raw = tokens.get(name)
  if (raw === undefined) throw new Error(`${name} is not defined in tokens.css`)
  if (seen.includes(name)) throw new Error(`${name} refers to itself`)
  return raw.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => value(ref, [...seen, name]))
}

// WCAG 2.x relative luminance and contrast ratio, for #rrggbb colours.
function luminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) throw new Error(`${hex} is not a #rrggbb colour`)
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((c) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(value(fg)), luminance(value(bg))]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('design tokens', () => {
  // These values are the design system's contract (spec 2026-10-18). Pages and ui components size
  // everything from them, so a changed value moves the whole app.
  it('defines the type, space, radius and page tokens', () => {
    const expected: Record<string, string> = {
      '--text-xs': '13px',
      '--text-xs-line': '18px',
      '--text-sm': '15px',
      '--text-sm-line': '22px',
      '--text-md': '17px',
      '--text-md-line': '26px',
      '--text-lg': '20px',
      '--text-lg-line': '28px',
      '--text-xl': '26px',
      '--text-xl-line': '32px',
      '--text-2xl': '36px',
      '--text-2xl-line': '42px',
      '--text-display': 'clamp(44px, 7vw, 88px)',
      '--text-display-line': '0.98',
      '--weight-regular': '400',
      '--weight-medium': '500',
      '--weight-bold': '700',
      '--weight-display': '800',
      '--tracking-body': '0',
      '--tracking-heading': '-0.01em',
      '--tracking-display': '-0.03em',
      '--space-1': '4px',
      '--space-2': '8px',
      '--space-3': '12px',
      '--space-4': '16px',
      '--space-5': '24px',
      '--space-6': '32px',
      '--space-7': '48px',
      '--space-8': '64px',
      '--space-9': '96px',
      '--radius-sm': '8px',
      '--radius-md': '12px',
      '--radius-lg': '16px',
      '--radius-pill': '999px',
      '--duration': '150ms',
      '--page-narrow': '640px',
      '--page': '960px',
      '--page-wide': '1200px',
      '--gutter': '16px',
    }
    for (const [name, v] of Object.entries(expected)) expect(value(name), name).toBe(v)
    for (const name of ['--font', '--shadow-1', '--shadow-pop', '--ease']) expect(tokens.has(name), name).toBe(true)
    expect(value('--font')).toMatch(/^'Outfit'/)
    // The gutter widens to 24px from 768px up.
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*:root\s*\{\s*--gutter:\s*24px;\s*\}\s*\}/)
  })

  // The brand colours are fixed (spec non-goals). The semantic tokens carry them.
  it('keeps the brand colours', () => {
    expect(value('--text')).toBe('#101928')
    expect(value('--text-muted')).toBe('#586283')
    expect(value('--surface')).toBe('#eceff1')
    expect(value('--attention')).toBe('#ff7c0a')
    expect(value('--action')).toBe('#19b820')
    expect(value('--danger')).toBe('#ff3b30')
  })

  // Muted text on the grey surface is the pair most likely to fail, and Fundit is a money app read by
  // everyone, so every text pair must meet WCAG AA for body text.
  it('token text pairs meet WCAG AA', () => {
    const pairs: [string, string][] = [
      ...['--text', '--text-muted', '--action-ink'].flatMap((fg) =>
        ['--bg', '--surface', '--surface-raised'].map((bg): [string, string] => [fg, bg]),
      ),
      ['--danger-ink', '--bg'],
      ['--text', '--attention-bg'],
      ['--text', '--success-bg'],
    ]
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  // Until Task 7 moves every page onto the new names, the old names must still resolve.
  it('keeps the old token names as aliases', () => {
    const aliases: Record<string, string> = {
      '--primary': '#586283',
      '--ink': '#101928',
      '--accent': '#ff7c0a',
      '--success': '#19b820',
      '--error': '#ff3b30',
      '--success-ink': '#0f7a14',
      '--error-ink': '#c0150b',
      '--muted': '#586283',
      '--card': '#eceff1',
      '--radius': '16px',
      '--page-width': '1200px',
    }
    for (const [name, v] of Object.entries(aliases)) expect(value(name), name).toBe(v)
    for (const name of ['--hover', '--weight-display-heavy']) expect(tokens.has(name), name).toBe(true)
  })
})
