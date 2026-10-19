import { defineConfig, devices } from '@playwright/test'
import { checkE2EBaseUrl } from './e2e/baseUrl'

// One-time setup for the shared e2e account (e2e/make-account.ts). It runs only against the live testnet site,
// because the passkey it saves is bound to that site's domain. See e2e/README.md.
const base = process.env.E2E_BASE_URL
if (!base) throw new Error('Set E2E_BASE_URL=https://fundit.fun. The shared e2e passkey must be made on the live testnet site.')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'make-account.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: { baseURL: checkE2EBaseUrl(base), ...devices['Desktop Chrome'] },
})
