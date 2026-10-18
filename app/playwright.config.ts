import { defineConfig, devices } from '@playwright/test'

// Runs against Arc testnet with real Circle passkeys (a virtual authenticator), so there is one worker and
// one serial spec. Circle accepts only the hostname localhost for the localhost client key, never 127.0.0.1.
const PORT = 5174
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
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
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host localhost`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
