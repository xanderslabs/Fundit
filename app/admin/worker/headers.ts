// Headers on every fundit-admin response: never indexed, never cached, no framing, a strict CSP.

export const ADMIN_CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self' https://rpc.mainnet.arc.io https://*.arc.io https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org; frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// Returns a copy with the headers set, since a response from ASSETS or fetch can have immutable headers.
export function secure(res: Response): Response {
  const out = new Response(res.body, res)
  out.headers.set('X-Robots-Tag', 'noindex, nofollow')
  out.headers.set('Cache-Control', 'no-store')
  out.headers.set('X-Content-Type-Options', 'nosniff')
  out.headers.set('Referrer-Policy', 'no-referrer')
  out.headers.set('Content-Security-Policy', ADMIN_CSP)
  out.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  return out
}
