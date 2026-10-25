// Cloudflare Turnstile's server check, shared by the fundit and fundit-admin Workers.
// Never log the secret or the token.

export const TURNSTILE_TOKEN = /^[A-Za-z0-9._:-]{1,2048}$/

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 15_000

// True only when Cloudflare says the token is good and the widget was solved on `hostname`. False on any error.
export async function verifyTurnstile(secret: string, token: string, ip: string, hostname: string): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const out = (await res.json()) as { success?: unknown; hostname?: unknown }
    return out.success === true && out.hostname === hostname
  } catch {
    return false
  }
}
