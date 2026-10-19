import { existsSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { getAddress, zeroAddress } from 'viem'
import { checkChain, checkEnv, NET, PASSKEY_PATH } from './arc'
import { addVirtualAuthenticator } from './passkey'
import { PASSKEY_FILE, serializeSharedPasskey } from './sharedPasskey'

// One-time setup: signs up the shared e2e account on the live testnet site and saves its passkey to
// app/.env.testnet.passkey. Run with `E2E_BASE_URL=https://fundit.fun npm --prefix app run e2e:make-account`.
// It never overwrites the file: the account behind an existing file would be lost with its money.
test('makes the shared e2e passkey account', async ({ browser, baseURL }) => {
  if (existsSync(PASSKEY_PATH)) {
    throw new Error(`app/${PASSKEY_FILE} already exists, so the shared account is made. This script never replaces it.`)
  }
  checkEnv()
  await checkChain()
  if (new URL(baseURL!).hostname !== 'fundit.fun') {
    throw new Error('Make the shared account on https://fundit.fun, the passkey domain of the testnet client key. Set E2E_BASE_URL=https://fundit.fun.')
  }

  const context = await browser.newContext()
  const page = await context.newPage()
  const passkeys = await addVirtualAuthenticator(page)
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Create one now' }).click()
  // Circle takes 5 to 50 characters from A-Z, a-z, 0-9 and _@.:+- only.
  const username = `e2e-shared-${Date.now()}`
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Save the passkey as soon as the authenticator holds it, before anything else can fail: a lost private key
  // would leave Circle with an orphan wallet. The address is filled in once the page shows it.
  await expect.poll(async () => (await passkeys.credentials()).length, { timeout: 60_000 }).toBe(1)
  const cred = (await passkeys.credentials())[0]!
  const save = (account: `0x${string}`, flag: 'wx' | 'w') =>
    writeFileSync(
      PASSKEY_PATH,
      serializeSharedPasskey({ credentialId: cred.credentialId, privateKey: cred.privateKey, userHandle: cred.userHandle ?? '', rpId: cred.rpId ?? '', account, username }),
      { flag, mode: 0o600 },
    )
  // 'wx' fails if the file appeared since the check above, so a second run can never replace it.
  save(zeroAddress, 'wx')
  expect(cred.rpId).toBe('fundit.fun')
  expect(cred.userHandle).toBeTruthy()

  await expect(page).toHaveURL(/\/me\?add=1$/, { timeout: 60_000 })
  const panel = page.getByRole('region', { name: 'Add money' })
  const shown = /0x[0-9a-fA-F]{40}/.exec(await panel.getByRole('tabpanel', { name: 'Your address' }).innerText())?.[0]
  expect(shown, `No address on the page. app/${PASSKEY_FILE} has the passkey; sign in with it to read the address.`).toBeTruthy()
  const account = getAddress(shown!)
  save(account, 'w')
  console.log(`Saved the shared e2e account ${account} (${username}) to app/${PASSKEY_FILE}: ${NET.explorerUrl}/address/${account}`)
  await context.close()
})
