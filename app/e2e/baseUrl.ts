// The suite spends real testnet USDC, so with E2E_BASE_URL it runs only against the live site or a local server.
// Anything else (a typo, www, a preview URL) fails before Playwright opens a page.
export function checkE2EBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`E2E_BASE_URL (${value}) is not a URL. Use https://fundit.fun or a localhost URL.`)
  }
  const live = url.protocol === 'https:' && url.host === 'fundit.fun'
  const local = (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === 'localhost'
  if (!live && !local) throw new Error(`E2E_BASE_URL (${value}) must be https://fundit.fun or a localhost URL.`)
  return url.origin
}
