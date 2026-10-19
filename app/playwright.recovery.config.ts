import { defineConfig, devices } from '@playwright/test'
import { checkE2EBaseUrl } from './e2e/baseUrl'

// The recovery journey (e2e/recovery.spec.ts). It signs up a new account on the live testnet site, so it runs
// only on its own, after a deploy, against https://fundit.fun. See e2e/README.md.
const base = process.env.E2E_BASE_URL
if (!base) throw new Error('Set E2E_BASE_URL=https://fundit.fun. Passkeys work only on the live testnet site.')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'recovery.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: { baseURL: checkE2EBaseUrl(base), trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
})
