// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clearSessionCookie, readSession, SESSION_COOKIE, SESSION_TTL_SEC, secretOk, sessionCookie, signSession, type Session } from './session'

const SECRET = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))
const OTHER_SECRET = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)))
const NOW = 1_800_000_000
const session: Session = {
  v: 1,
  address: '0x3552e9c14c7b6050839009a5b160a4446a1e916d',
  chainId: 5042002,
  factory: '0x6890d40a9a472d0d05adb5938d85b07059ad54ab',
  iat: NOW,
  exp: NOW + SESSION_TTL_SEC,
}

const header = (value: string) => `theme=light; ${SESSION_COOKIE}=${value}; other=1`

describe('session', () => {
  it('a signed session reads back', async () => {
    const value = await signSession(session, SECRET)
    expect(await readSession(header(value), SECRET, NOW + 60)).toEqual(session)
  })

  // The address in the cookie decides who is signed in, so changing it must break the cookie.
  it('refuses a tampered payload', async () => {
    const value = await signSession(session, SECRET)
    const [payload, mac] = value.split('.') as [string, string]
    const json = new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))
    const changed = json.replace('0x3552', '0x4552')
    expect(changed).not.toBe(json)
    const forged = btoa(changed).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await readSession(header(`${forged}.${mac}`), SECRET, NOW)).toBeNull()
  })

  it('refuses a cookie signed with another secret', async () => {
    const value = await signSession(session, OTHER_SECRET)
    expect(await readSession(header(value), SECRET, NOW)).toBeNull()
  })

  it('refuses an expired cookie', async () => {
    const value = await signSession(session, SECRET)
    expect(await readSession(header(value), SECRET, NOW + SESSION_TTL_SEC)).toBeNull()
  })

  it('refuses a malformed cookie', async () => {
    const value = await signSession(session, SECRET)
    for (const bad of ['', 'abc', `${value}.x`, value.replace('.', ''), `${value.split('.')[0]}.`, '..', `!!.${value.split('.')[1]}`]) {
      expect(await readSession(header(bad), SECRET, NOW)).toBeNull()
    }
    expect(await readSession(null, SECRET, NOW)).toBeNull()
    expect(await readSession('other=1', SECRET, NOW)).toBeNull()
    // A well signed payload of the wrong shape is refused too.
    const wrong = await signSession({ ...session, address: '0x3552E9c14C7b6050839009A5B160A4446a1e916D' }, SECRET)
    expect(await readSession(header(wrong), SECRET, NOW)).toBeNull()
    const v2 = await signSession({ ...session, v: 2 } as unknown as Session, SECRET)
    expect(await readSession(header(v2), SECRET, NOW)).toBeNull()
  })

  // __Host- makes the browser refuse the cookie unless it is Secure, Path=/ and has no Domain, so a sibling
  // subdomain cannot set or widen it. HttpOnly keeps it from page scripts and SameSite=Strict from other sites.
  it('the cookie has __Host-, Path=/, HttpOnly, Secure, SameSite=Strict and Max-Age=28800', () => {
    expect(SESSION_COOKIE).toBe('__Host-fundit_admin')
    const parts = sessionCookie('v.m').split('; ')
    expect(parts[0]).toBe('__Host-fundit_admin=v.m')
    expect(parts.slice(1).sort()).toEqual(['HttpOnly', 'Max-Age=28800', 'Path=/', 'SameSite=Strict', 'Secure'])
    expect(clearSessionCookie()).toMatch(/^__Host-fundit_admin=; /)
    expect(clearSessionCookie()).toContain('Max-Age=0')
    expect(clearSessionCookie()).toContain('Path=/')
  })

  it('secretOk refuses a secret under 32 bytes', () => {
    expect(secretOk(SECRET)).toBe(true)
    expect(secretOk(btoa('x'.repeat(31)))).toBe(false)
    expect(secretOk(undefined)).toBe(false)
    expect(secretOk('')).toBe(false)
    expect(secretOk('not base64 at all!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')).toBe(false)
  })
})
