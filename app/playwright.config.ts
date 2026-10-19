import { defineConfig, devices } from '@playwright/test'
import { checkE2EBaseUrl } from './e2e/baseUrl'

// Runs against Arc testnet with real Circle passkeys (a virtual authenticator), so there is one worker and
// one serial spec.
//
// Run it with E2E_BASE_URL=https://fundit.fun (see e2e/README.md). The suite signs in with one shared passkey,
// and a passkey works only on its own domain, fundit.fun. Without E2E_BASE_URL Playwright still starts the dev
// server on localhost, but the suite stops at the start: local runs can no longer use passkeys.
const PORT = 5174
const BASE_URL = process.env.E2E_BASE_URL ? checkE2EBaseUrl(process.env.E2E_BASE_URL) : `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // The recovery journey signs up a new account each run. It runs on its own with npm run e2e:recovery.
  testIgnore: 'recovery.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // A passkey user operation on Arc testnet confirms in seconds. These cover a slow bundler or RPC.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // The dev server reads app/.env.local (testnet network, localhost client key, testnet factory).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx vite --port ${PORT} --strictPort --host localhost`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
})
