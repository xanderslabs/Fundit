import type { Page } from '@playwright/test'

// A WebAuthn virtual authenticator on the page, through Chromium's DevTools protocol. It behaves like a
// platform passkey (internal transport, resident keys, user verification that always passes), so Circle's
// real register and login flows run with no prompt. Credentials live as long as the page.
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return {
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
  }
}
