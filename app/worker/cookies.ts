// Circle's userToken and refreshToken live only in these cookies. HttpOnly keeps them from page scripts,
// SameSite=Strict keeps other sites from sending them, and the path limits them to the Worker's routes.

export const USER_COOKIE = 'ucw_ut'
export const REFRESH_COOKIE = 'ucw_rt'

// Circle tokens are JWTs or base64, so + / = can appear. All of these are valid in a cookie value.
export const TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/

// Circle's refresh token lasts 14 days. The user token expires sooner, but refresh needs the old one as well.
const MAX_AGE = 14 * 24 * 60 * 60
const ATTRIBUTES = 'Path=/api/ucw; HttpOnly; Secure; SameSite=Strict'

// Set-Cookie values for a fresh pair. Callers check both against TOKEN first.
export function tokenCookies(userToken: string, refreshToken: string): [string, string] {
  return [`${USER_COOKIE}=${userToken}; ${ATTRIBUTES}; Max-Age=${MAX_AGE}`, `${REFRESH_COOKIE}=${refreshToken}; ${ATTRIBUTES}; Max-Age=${MAX_AGE}`]
}

export function clearTokenCookies(): [string, string] {
  return [`${USER_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`, `${REFRESH_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`]
}

// Reads the pair from a Cookie header. A value that is not a token shape counts as missing.
export function readTokens(header: string | null): { userToken: string | null; refreshToken: string | null } {
  const values = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) values.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  const pick = (name: string) => {
    const v = values.get(name)
    return v !== undefined && TOKEN.test(v) ? v : null
  }
  return { userToken: pick(USER_COOKIE), refreshToken: pick(REFRESH_COOKIE) }
}
