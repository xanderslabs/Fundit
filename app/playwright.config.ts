import { defineConfig, devices } from '@playwright/test'
import { checkE2EBaseUrl } from './e2e/baseUrl'

// Runs against Arc testnet with real transactions, so there is one worker and serial specs.
//
// Without E2E_BASE_URL Playwright starts the dev server on localhost. Set E2E_BASE_URL=https://fundit.fun to run
// against the live site instead (see e2e/README.md).
const PORT = 5174
const BASE_URL = process.env.E2E_BASE_URL ? checkE2EBaseUrl(process.env.E2E_BASE_URL) : `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // A transaction on Arc testnet confirms in seconds. These cover a slow RPC.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // The dev server reads app/.env.local (testnet network, testnet factory).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx vite --port ${PORT} --strictPort --host localhost`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
})
