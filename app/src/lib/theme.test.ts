import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme'

// The theme follows the system setting until the person picks one, and an explicit pick always wins.
describe('resolveTheme', () => {
  it('follows the system while the choice is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('keeps an explicit choice whatever the system says', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
