import { describe, expect, it } from 'vitest'
import headers from '../../public/_headers?raw'
import gate0Headers from '../../gate0.headers?raw'
import { gate0Enabled, withGate0Headers } from './build'

// The Gate 0 page has a loose CSP so G9 can find the sign-in hosts. A normal build of any branch must never ship
// the page or that CSP: both come only with VITE_GATE0=1.
describe('Gate 0 build switch', () => {
  it('is off unless VITE_GATE0 is exactly 1', () => {
    expect(gate0Enabled({})).toBe(false)
    expect(gate0Enabled({ VITE_GATE0: '0' })).toBe(false)
    expect(gate0Enabled({ VITE_GATE0: 'true' })).toBe(false)
    expect(gate0Enabled({ VITE_GATE0: '1' })).toBe(true)
  })

  it('keeps every gate0 rule out of public/_headers, which every build copies', () => {
    expect(headers).not.toMatch(/gate0/i)
  })

  it('applies the loose CSP to the exact gate page paths only, with script-src self', () => {
    const paths = gate0Headers.split('\n').filter((l) => l.startsWith('/'))
    expect(paths).toEqual(['/gate0', '/gate0.html', '/gate1', '/gate1.html'])
    for (const csp of gate0Headers.split('\n').filter((l) => /^\s+Content-Security-Policy:/.test(l))) {
      expect(csp).toMatch(/script-src 'self';/)
      expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*(\*|https:|unsafe-inline)/)
    }
  })

  it('appends the gate0 rules after the site rules, leaving those unchanged', () => {
    const out = withGate0Headers(headers, gate0Headers)
    expect(out.startsWith(headers.replace(/\n*$/, '\n'))).toBe(true)
    expect(out.endsWith(gate0Headers)).toBe(true)
  })
})
