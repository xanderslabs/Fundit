import { describe, expect, it } from 'vitest'
import { safeHttpsUrl } from './urls'

describe('safeHttpsUrl', () => {
  // Campaign links and images are attacker-controlled, so only plain https URLs may reach an href or src.
  it.each(['javascript:alert(1)', 'http://x', 'data:text/html,hi', 'data:', '', 'not a url', ' javascript:alert(1)'])(
    'rejects %j',
    (u) => {
      expect(safeHttpsUrl(u)).toBeNull()
    },
  )

  it('returns an https URL unchanged', () => {
    expect(safeHttpsUrl('https://a.b/c')).toBe('https://a.b/c')
  })

  it('rejects URLs over 500 characters', () => {
    expect(safeHttpsUrl(`https://a.b/${'x'.repeat(500)}`)).toBeNull()
  })
})
