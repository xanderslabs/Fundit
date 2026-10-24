import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { type Address, formatUnits, getAddress, parseAbi, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { CIRCLE_MULTISIG_PLUGIN } from '../src/config'
import { arc, checkChain, checkEnv, fundFromFunder, funderAddress, logTx, NET, usdcBalance } from './arc'
import { addVirtualAuthenticator } from './passkey'

// Recovery with the recovery key, end to end on the live testnet site. A new throwaway account saves a recovery
// key, loses its passkey (new browser context, new virtual authenticator), recovers with the words, and must then
// open the same account after a reload and after a fresh sign-in with the new passkey. Before the fix a recovered
// passkey opened a new, empty account. Not part of `npm run e2e`: run it with `npm run e2e:recovery` (see
// e2e/README.md). Each run signs up one new account and sends what is left back to the funder at the end.
test.describe.configure({ mode: 'serial' })

// The first operation (saving the recovery key) also deploys the account. Before it, the app asks for the fallback
// reserve of a new account: 1.6M gas x Circle's fee x 1.25, which is 1.78 USDC at 890 gwei (2026-10-19). With
// 1.5 USDC the page asked to add money first. The rest goes back to the funder at the end.
const FIRST_FUNDING = parseUnits('2.5', 6)
// What the account must hold before the recovery: the recovery operation's reserve and the tiny send after it.
const BEFORE_RECOVERY = parseUnits('1', 6)
const TINY_SEND = '0.01'

const ownershipAbi = parseAbi([
  'struct OwnerData { uint256 weight; uint8 credType; address addr; uint256 publicKeyX; uint256 publicKeyY; }',
  'function ownershipInfoOf(address account) view returns (bytes30[] ownerIds, OwnerData[] ownersData, uint256 thresholdWeight)',
])

let context: BrowserContext
let page: Page
let passkeys: Awaited<ReturnType<typeof addVirtualAuthenticator>>
let funder: Address
let account: Address
let words: string[]

async function newDevice(browser: import('@playwright/test').Browser) {
  context = await browser.newContext()
  page = await context.newPage()
  passkeys = await addVirtualAuthenticator(page)
  page.on('dialog', (d) => void d.accept())
}

// Waits for the success text, or stops early on an error the page shows, with that error in the failure.
async function settled(scope: Locator, success: string, timeout = 90_000) {
  const done = scope.getByText(success)
  const failed = scope.locator('.status-error')
  await expect(done.or(failed).first()).toBeVisible({ timeout })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.first().innerText()}`)
}

// The account address My page shows in the Add money panel.
async function shownAddress(): Promise<Address> {
  await page.goto('/me')
  await page.getByRole('region', { name: 'Your Fundit account' }).getByRole('button', { name: 'Add money' }).click()
  const panel = page.getByRole('region', { name: 'Add money' })
  const shown = /0x[0-9a-fA-F]{40}/.exec(await panel.innerText())?.[0]
  expect(shown, 'no account address on My page').toBeTruthy()
  return getAddress(shown!)
}

async function signOut() {
  // The account pill, named by the passkey's username or the address, opens the account menu.
  await page.getByRole('banner').locator('button[aria-haspopup="menu"]').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
}

async function sendOut(amount: string | 'max') {
  await page.goto('/me')
  await page.getByRole('region', { name: 'Your Fundit account' }).getByRole('button', { name: 'Send' }).click()
  const send = page.getByRole('region', { name: 'Send money out' })
  await expect(send.getByText(/^You have .* in your Fundit account\.$/)).toBeVisible({ timeout: 30_000 })
  if (amount === 'max') {
    await send.getByRole('button', { name: 'Max' }).click()
    await expect(send.getByRole('textbox', { name: 'Amount' })).not.toHaveValue('')
  } else {
    await send.getByRole('textbox', { name: 'Amount' }).fill(amount)
  }
  await send.getByLabel('Recipient').fill(funder)
  await send.getByRole('button', { name: 'Send', exact: true }).click()
  await settled(send, 'Your money was sent.')
}

test.beforeAll(async ({ browser }) => {
  checkEnv()
  await checkChain()
  funder = funderAddress()
  console.log(`Funder ${funder} holds ${formatUnits(await usdcBalance(funder), 6)} USDC`)
  await newDevice(browser)
})

// Above this, a run that stopped early still has money worth sending back. Below it is the send's own reserve.
const DUST = parseUnits('0.3', 6)

test.afterAll(async () => {
  if (account && (await usdcBalance(account)) > DUST && page && !page.isClosed()) {
    // A failed step skips the last test, and after the passkey moves the words exist only in this run's memory.
    try {
      await sendOut('max')
    } catch (err) {
      console.log(`Could not send the rest back: ${String(err).split('\n')[0]}`)
    }
  }
  await context?.close()
  if (!account) return
  const left = await usdcBalance(account)
  const note = left > DUST ? 'STRANDED, send it back by hand' : 'dust'
  console.log(`Recovery test account ${account} keeps ${formatUnits(left, 6)} USDC (${note}): ${NET.explorerUrl}/address/${account}`)
})

test('signs up a throwaway account with a fresh passkey and funds it', async () => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Create one now' }).click()
  // Circle takes 5 to 50 characters from A-Z, a-z, 0-9 and _@.:+- only.
  await page.getByLabel('Username').fill(`e2e-recover-${Date.now()}`)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/me\?add=1$/, { timeout: 60_000 })
  // The backup prompt after sign-up. The recovery key is saved from My page once the account has money.
  const later = page.getByRole('dialog').getByRole('button', { name: 'Later' })
  if (await later.isVisible().catch(() => false)) await later.click()
  expect(await passkeys.credentials()).toHaveLength(1)

  account = await shownAddress()
  console.log(`Recovery test account ${account}: ${NET.explorerUrl}/address/${account}`)
  logTx('Fund the account (funder transfer)', await fundFromFunder(account, FIRST_FUNDING))
  expect(await usdcBalance(account)).toBeGreaterThanOrEqual(FIRST_FUNDING)
})

test('saves a recovery key and keeps its words', async () => {
  await page.goto('/me')
  const banner = page.getByRole('region', { name: 'Recovery key', exact: true })
  await banner.getByRole('button', { name: 'Save now' }).click()
  const backup = page.getByRole('region', { name: 'Add a recovery key' })
  const show = backup.getByRole('button', { name: 'Show my recovery key' })
  const short = backup.getByText('Add a little money first.')
  await expect(show.and(page.locator(':enabled')).or(short)).toBeVisible({ timeout: 45_000 })
  if (await short.count()) throw new Error(`The page asks to add money first: raise FIRST_FUNDING (account holds ${formatUnits(await usdcBalance(account), 6)} USDC).`)
  await show.click()
  const phrase = backup.locator('ol.recovery-phrase li')
  await expect(phrase).toHaveCount(12)
  words = await phrase.allInnerTexts()
  const asked = backup.getByLabel(/^Word #\d+$/)
  await expect(asked).toHaveCount(3)
  for (const input of await asked.all()) {
    const n = Number((await input.getAttribute('id'))!.split('-word-')[1])
    await input.fill(words[n - 1]!)
  }
  await backup.getByRole('button', { name: 'Add the recovery key' }).click()
  const error = backup.locator('.field-error')
  const state = async () => ((await error.count()) ? `error: ${await error.first().innerText()}` : (await backup.count()) ? 'open' : 'saved')
  await expect.poll(state, { timeout: 90_000 }).not.toBe('open')
  expect(await state()).toBe('saved')

  const recovery = mnemonicToAccount(words.join(' ')).address
  const [, owners] = await arc.readContract({ address: CIRCLE_MULTISIG_PLUGIN, abi: ownershipAbi, functionName: 'ownershipInfoOf', args: [account] })
  expect(owners.map((o) => o.addr.toLowerCase())).toContain(recovery.toLowerCase())
})

test('loses the passkey: signs out, clears storage and moves to a new device', async ({ browser }) => {
  await signOut()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await context.close()
  await newDevice(browser)
  expect(await passkeys.credentials()).toHaveLength(0)
  // The recovery's own operation and the tiny send after it need their reserve on hand.
  const held = await usdcBalance(account)
  if (held < BEFORE_RECOVERY) logTx('Top up before recovery (funder transfer)', await fundFromFunder(account, BEFORE_RECOVERY - held))
})

test('recovers the account with the words on the new device', async () => {
  await page.goto('/recover')
  for (const [i, w] of words.entries()) await page.getByRole('textbox', { name: `Word ${i + 1}`, exact: true }).fill(w)
  await page.getByLabel('Name for your new passkey').fill(`e2e-recovered-${Date.now()}`)
  await page.getByRole('button', { name: 'Recover my account' }).click()
  const back = page.getByRole('heading', { level: 1, name: 'Your account is back.' })
  const failed = page.locator('.recover .form-error')
  await expect(back.or(failed).first()).toBeVisible({ timeout: 120_000 })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.first().innerText()}`)
  expect(await passkeys.credentials()).toHaveLength(1)
})

// The bug: after a reload the new passkey derived its own address and the send refused with "That passkey opens
// a different wallet".
test('after a reload, sends a tiny amount from the recovered account', async () => {
  await page.reload()
  expect(await shownAddress()).toBe(account)
  const before = await usdcBalance(funder)
  await sendOut(TINY_SEND)
  // At least: the funder may receive something else during the run.
  expect(await usdcBalance(funder)).toBeGreaterThanOrEqual(before + parseUnits(TINY_SEND, 6))
})

test('signs in fresh with the new passkey and opens the same account', async () => {
  await signOut()
  await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in with your passkey' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeHidden({ timeout: 60_000 })
  expect(await shownAddress()).toBe(account)
  const held = await usdcBalance(account)
  expect(held).toBeGreaterThan(0n)
  const card = page.getByRole('region', { name: 'Your Fundit account' })
  await expect(card.locator('.dash-balances div', { hasText: 'USDC' }).locator('dd')).not.toHaveText(/^0(\.00)?$/, { timeout: 45_000 })
})

test('sends what is left back to the funder', async () => {
  const before = await usdcBalance(funder)
  await sendOut('max')
  expect(await usdcBalance(funder)).toBeGreaterThan(before)
})
