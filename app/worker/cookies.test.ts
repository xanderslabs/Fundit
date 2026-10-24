// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clearTokenCookies, readTokens, tokenCookies } from './cookies'

const UT = 'eyJhbGciOiJIUzI1NiJ9.user-token.signature'
const RT = 'refresh+token/with=base64chars'

describe('token cookies', () => {
  // The page must never read the tokens (an XSS could take them), other sites must never send them, and only
  // the Worker's own routes need them.
  it('sets both cookies HttpOnly Secure SameSite=Strict on /api/ucw', () => {
    const [ut, rt] = tokenCookies(UT, RT)
    expect(ut).toMatch(new RegExp(`^ucw_ut=${UT.replace(/[.+/=]/g, '\\$&')};`))
    expect(rt).toMatch(new RegExp(`^ucw_rt=${RT.replace(/[.+/=]/g, '\\$&')};`))
    for (const c of [ut, rt]) {
      expect(c).toContain('; HttpOnly')
      expect(c).toContain('; Secure')
      expect(c).toContain('; SameSite=Strict')
      expect(c).toContain('; Path=/api/ucw')
      expect(c).toMatch(/; Max-Age=\d+/)
    }
  })

  it('reads tokens back from a Cookie header', () => {
    expect(readTokens(`theme=light; ucw_ut=${UT}; ucw_rt=${RT}`)).toEqual({ userToken: UT, refreshToken: RT })
    expect(readTokens(null)).toEqual({ userToken: null, refreshToken: null })
    // A value that is not a token shape is ignored, so a crafted cookie never reaches Circle's header.
    expect(readTokens('ucw_ut=short; ucw_rt=bad\u0000value')).toEqual({ userToken: null, refreshToken: null })
  })

  it('signout clears both with Max-Age=0', () => {
    const cleared = clearTokenCookies()
    expect(cleared).toHaveLength(2)
    expect(cleared[0]).toMatch(/^ucw_ut=;/)
    expect(cleared[1]).toMatch(/^ucw_rt=;/)
    for (const c of cleared) {
      expect(c).toContain('; Max-Age=0')
      expect(c).toContain('; Path=/api/ucw')
      expect(c).toContain('; HttpOnly')
      expect(c).toContain('; Secure')
      expect(c).toContain('; SameSite=Strict')
    }
  })
})
