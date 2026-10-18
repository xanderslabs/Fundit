import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { type Address, formatUnits, getAddress, type Hex, pad, parseAbi, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { campaignAbi } from '../src/abi/campaign'
import { factoryAbi } from '../src/abi/factory'
import { CIRCLE_MULTISIG_PLUGIN } from '../src/config'
import { formatAmount } from '../src/lib/format'
import { arc, checkChain, checkEnv, fundFromFunder, funderAddress, logTx, NET, txUrl, usdcBalance } from './arc'
import { addVirtualAuthenticator } from './passkey'

// One throwaway Fundit account goes through every journey in order, so the funder pays once per run. The
// page, its virtual passkey and the account carry over from test to test: a failed step skips the rest.
test.describe.configure({ mode: 'serial' })

// What the funder sends. The account gives GIFT of it, withdraws it back and sends the rest to the funder.
// A run costs the gas of five user operations, the 1% fees, the estimated reserve (the prefund) that Max keeps
// back in the account, and whatever prefund is left in the account's EntryPoint deposit. Circle's bundler prices user operations far
// above Arc's base fee, and the first one also deploys the account, so the top-up must cover that prefund.
const TOP_UP = parseUnits('3', 6)
const GIFT = '0.2'
const MESSAGE = 'Good luck from the e2e run'

const ownershipAbi = parseAbi([
  'struct OwnerData { uint256 weight; uint8 credType; address addr; uint256 publicKeyX; uint256 publicKeyY; }',
  'function ownershipInfoOf(address account) view returns (bytes30[] ownerIds, OwnerData[] ownersData, uint256 thresholdWeight)',
])

let context: BrowserContext
let page: Page
let passkeys: Awaited<ReturnType<typeof addVirtualAuthenticator>>
let factory: Address
let account: Address
let campaign: Address
let funder: Address
let funderStart: bigint
let fromBlock: bigint

// Transaction hashes of the account's user operations, read from Circle's bundler answers as the page gets them.
const userOpTxs: Hex[] = []
let reported = 0
function logUserOps(label: string) {
  const fresh = userOpTxs.slice(reported)
  reported = userOpTxs.length
  expect(fresh.length, `${label}: no user operation receipt seen`).toBeGreaterThan(0)
  for (const hash of fresh) logTx(label, hash)
  return fresh
}

function collectUserOpReceipts(p: Page) {
  p.on('response', async (res) => {
    if (!res.url().startsWith(`https://modular-sdk.circle.com/`) || res.request().method() !== 'POST') return
    try {
      const sent = res.request().postDataJSON() as { method?: string } | { method?: string }[]
      const got = (await res.json()) as { result?: { receipt?: { transactionHash?: Hex } } } | { result?: { receipt?: { transactionHash?: Hex } } }[]
      const reqs = Array.isArray(sent) ? sent : [sent]
      const answers = Array.isArray(got) ? got : [got]
      reqs.forEach((r, i) => {
        const hash = r.method === 'eth_getUserOperationReceipt' ? answers[i]?.result?.receipt?.transactionHash : undefined
        if (hash && !userOpTxs.includes(hash)) userOpTxs.push(hash)
      })
    } catch {
      // Not JSON-RPC. Ignore.
    }
  })
}

// Waits for the success text, or stops early on an error the page shows, with that error in the failure.
async function settled(scope: Locator, success: string, timeout = 90_000) {
  const done = scope.getByText(success)
  // Only a failed send's status box. A form field alert can be right after success: a Max send leaves less than
  // the reserve, so Send money out then says "Add at least ...".
  const failed = scope.locator('.status-error')
  await expect(done.or(failed).first()).toBeVisible({ timeout })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.first().innerText()}`)
  await expect(done).toBeVisible()
}

async function openMenuItem(name: string) {
  await page.getByRole('banner').getByRole('button', { name: `${account.slice(0, 6)}...${account.slice(-4)}` }).click()
  await page.getByRole('menuitem', { name }).click()
}

test.beforeAll(async ({ browser }) => {
  factory = checkEnv().factory
  await checkChain()
  funder = funderAddress()
  funderStart = await usdcBalance(funder)
  console.log(`Funder ${funder} holds ${formatUnits(funderStart, 6)} USDC`)
  expect(funderStart, 'the funder needs testnet USDC from https://faucet.circle.com').toBeGreaterThan(TOP_UP + parseUnits('0.1', 6))
  fromBlock = await arc.getBlockNumber()

  context = await browser.newContext()
  page = await context.newPage()
  passkeys = await addVirtualAuthenticator(page)
  collectUserOpReceipts(page)
  // window.confirm, for leaving with words on screen and the like. No journey here should need one.
  page.on('dialog', (d) => {
    console.log(`dialog: ${d.message()}`)
    void d.accept()
  })
})

test.afterAll(async () => {
  await context?.close()
  if (funderStart === undefined) return
  const end = await usdcBalance(funder)
  console.log(`Funder spent ${formatUnits(funderStart - end, 6)} USDC this run, ${formatUnits(end, 6)} USDC left`)
  if (account) console.log(`Test account ${account} keeps ${formatUnits(await usdcBalance(account), 6)} USDC`)
})

test('signs up with a passkey', async () => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Create one now' }).click()
  // Circle takes 5 to 50 characters from A-Z, a-z, 0-9 and _@.:+- only.
  await page.getByLabel('Username').fill(`e2e-${Date.now()}`)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Sign-up lands on Add money, which shows the new account's address.
  await expect(page).toHaveURL(/\/add-money$/, { timeout: 60_000 })
  const panel = page.getByRole('region', { name: 'Send to your Fundit account' })
  const shown = /0x[0-9a-fA-F]{40}/.exec(await panel.innerText())?.[0]
  expect(shown).toBeTruthy()
  account = getAddress(shown!)
  console.log(`Fundit account ${account}: ${NET.explorerUrl}/address/${account}`)
  await expect(page.getByRole('banner').getByRole('button', { name: `${account.slice(0, 6)}...${account.slice(-4)}` })).toBeVisible()

  // The passkey is on the virtual authenticator, bound to localhost (Circle's rpId for this client key).
  const creds = await passkeys.credentials()
  expect(creds).toHaveLength(1)
  expect(creds[0]!.rpId).toBe('localhost')
  // A new account has no code and no money until its first user operation.
  expect(await arc.getCode({ address: account })).toBeUndefined()
  expect(await usdcBalance(account)).toBe(0n)

  // The recovery key prompt opens right away, but the backup needs gas first, so it points to Add money.
  const prompt = page.getByRole('dialog')
  await expect(prompt.getByText('Add a little money first.')).toBeVisible()
  await prompt.getByRole('link', { name: 'Add money' }).click()
  await expect(prompt).toHaveCount(0)
})

test('adds money: the funder sends USDC to the account address', async () => {
  const hash = await fundFromFunder(account, TOP_UP)
  logTx('Add money (funder transfer)', hash)
  expect(await usdcBalance(account)).toBe(TOP_UP)
  // The page polls every 15 seconds.
  await expect(page.getByText(`Balance: ${formatAmount(TOP_UP, 'USDC')} and 0.00 EURC`)).toBeVisible({ timeout: 45_000 })
})

test('saves the recovery key after confirming three words', async () => {
  await openMenuItem('My page')
  await expect(page).toHaveURL(/\/me$/)
  const backup = page.getByRole('region', { name: 'Add a recovery key' })
  await backup.getByRole('button', { name: 'Show my recovery key' }).click()
  const phrase = backup.locator('ol.recovery-phrase li')
  await expect(phrase).toHaveCount(12)
  const words = await phrase.allInnerTexts()

  // Three of the twelve, picked at random by the page.
  const asked = backup.getByLabel(/^Word #\d+$/)
  await expect(asked).toHaveCount(3)
  for (const input of await asked.all()) {
    const n = Number((await input.getAttribute('id'))!.split('-word-')[1])
    await input.fill(words[n - 1]!)
  }
  await backup.getByRole('button', { name: 'Add the recovery key' }).click()
  // Saved: My page stops asking.
  const error = backup.locator('.field-error')
  const state = async () => ((await error.count()) ? `error: ${await error.first().innerText()}` : (await backup.count()) ? 'open' : 'saved')
  await expect.poll(state, { timeout: 90_000 }).not.toBe('open')
  expect(await state()).toBe('saved')
  logUserOps('Save the recovery key')

  // On chain the recovery key's address is now an owner next to the passkey.
  const recovery = mnemonicToAccount(words.join(' ')).address
  const [ownerIds, owners] = await arc.readContract({ address: CIRCLE_MULTISIG_PLUGIN, abi: ownershipAbi, functionName: 'ownershipInfoOf', args: [account] })
  expect(ownerIds).toHaveLength(2)
  expect(owners.map((o) => o.addr.toLowerCase())).toContain(recovery.toLowerCase())
})

test('creates a Fundit', async () => {
  await openMenuItem('Start a Fundit')
  await expect(page).toHaveURL(/\/create$/)
  await page.getByLabel('Title').fill('E2E testnet garden fund')
  await page.getByLabel('Description').fill('Seeds and tools for the community garden. Made by the e2e suite.')
  await page.getByLabel('Goal').fill('10')
  await expect(page.getByText('Fundit keeps 1% of each donation.')).toBeVisible()
  await page.getByRole('button', { name: 'Create a Fundit' }).click()
  const live = page.getByRole('heading', { level: 1, name: 'Your Fundit is live' })
  const failed = page.locator('.create-status .status-error')
  await expect(live.or(failed)).toBeVisible({ timeout: 90_000 })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.innerText()}`)
  const href = await page.getByRole('link', { name: 'Go to your Fundit' }).getAttribute('href')
  expect(href).toMatch(/^\/c\/0x[0-9a-fA-F]{40}$/)
  campaign = getAddress(href!.split('/c/')[1]!)
  console.log(`Fundit ${campaign}: ${NET.explorerUrl}/address/${campaign}`)
  const [tx] = logUserOps('Create a Fundit')

  // The factory recorded this account as the creator, in USDC, with a goal of 10.
  const created = await arc.getContractEvents({ address: factory, abi: factoryAbi, eventName: 'CampaignCreated', args: { campaign }, fromBlock })
  expect(created).toHaveLength(1)
  expect(created[0]!.transactionHash).toBe(tx)
  expect(getAddress(created[0]!.args.creator!)).toBe(account)
  const summary = await arc.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })
  expect(getAddress(summary.creator)).toBe(account)
  expect(getAddress(summary.token)).toBe(NET.usdc)
  expect(summary.goal).toBe(parseUnits('10', 6))
})

test('gives anonymously with a message, and the activity shows Anonymous', async () => {
  await page.getByRole('link', { name: 'Go to your Fundit' }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${campaign}$`))
  const give = page.getByRole('region', { name: 'Give' })
  await expect(give.getByText(/Your balance: /)).toBeVisible()
  await give.getByRole('textbox', { name: 'Amount' }).fill(GIFT)
  await give.getByLabel('Message (optional)').fill(MESSAGE)
  // No tip: the gift checks below expect a zero tip.
  await expect(give.getByRole('group', { name: 'Tip Fundit (optional)' }).getByRole('radio', { name: 'No tip' })).toBeChecked()
  await give.getByRole('switch', { name: 'Hide my name' }).check()
  await expect(give.getByText(`${new TextEncoder().encode(MESSAGE).length} of 274 bytes`)).toBeVisible()
  // The account's real reserve estimate, shown as the most the network fee can take.
  await expect(give.getByLabel('Breakdown').getByText(/^up to \d+\.\d+ USDC$/)).toBeVisible()
  await give.getByRole('button', { name: 'Give', exact: true }).click()
  await settled(give, 'Thank you. Your donation went through.')
  const shownLink = await give.getByRole('link', { name: 'View it on the Arc explorer' }).getAttribute('href')
  const [tx] = logUserOps('Give anonymously')
  expect(shownLink).toBe(txUrl(tx!))

  const activity = page.getByRole('region', { name: 'Activity' })
  await expect(activity.getByRole('listitem').first()).toContainText('Anonymous gave 0.20 USDC', { timeout: 30_000 })
  await expect(activity.getByText(MESSAGE, { exact: true })).toBeVisible()
  await expect(activity.getByText(/\[anon\]/)).toHaveCount(0)

  // On chain the gift is public: the event names the account, and the message carries the marker.
  const events = await arc.getContractEvents({ address: campaign, abi: campaignAbi, eventName: 'Donated', fromBlock })
  expect(events).toHaveLength(1)
  const gift = events[0]!
  expect(gift.transactionHash).toBe(tx)
  expect(getAddress(gift.args.donor!)).toBe(account)
  expect(gift.args.amount).toBe(parseUnits(GIFT, 6))
  expect(gift.args.tip).toBe(0n)
  expect(gift.args.message).toBe(`[anon]${MESSAGE}`)
  const summary = await arc.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })
  expect(summary.raised).toBe(parseUnits(GIFT, 6))
  expect(summary.available).toBe(parseUnits(GIFT, 6) - gift.args.fee!)
})

test('withdraws on Arc from Manage', async () => {
  await page.getByRole('link', { name: 'Manage this Fundit' }).click()
  await expect(page).toHaveURL(new RegExp(`/manage/${campaign}$`))
  const available = (await arc.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })).available
  const withdraw = page.getByRole('region', { name: 'Withdraw' })
  await expect(withdraw.getByText(`Available: ${formatAmount(available, 'USDC')}`)).toBeVisible()
  await withdraw.getByRole('button', { name: 'Max' }).click()
  // The recipient defaults to the account itself, on Arc.
  await expect(withdraw.getByLabel('Recipient')).toHaveValue(new RegExp(account, 'i'))
  await withdraw.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await settled(withdraw, 'Your withdrawal went through.')
  const [tx] = logUserOps('Withdraw on Arc')

  const events = await arc.getContractEvents({ address: campaign, abi: campaignAbi, eventName: 'Withdrawn', fromBlock })
  expect(events).toHaveLength(1)
  const out = events[0]!
  expect(out.transactionHash).toBe(tx)
  // Arc payouts name the recipient as a left-padded bytes32.
  expect(out.args.recipient).toBe(pad(account.toLowerCase() as Hex))
  expect(out.args.amount).toBe(available)
  expect(out.args.net).toBe(available - out.args.fee!)
  expect(out.args.destDomain).toBe(NET.domain)
  expect((await arc.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })).available).toBe(0n)
  await expect(withdraw.getByText('Available: 0.00 USDC')).toBeVisible({ timeout: 30_000 })
})

test('sends money out on Arc back to the funder', async () => {
  await openMenuItem('My page')
  await expect(page).toHaveURL(/\/me$/)
  const send = page.getByRole('region', { name: 'Send money out' })
  const held = await usdcBalance(account)
  const before = await usdcBalance(funder)
  // The form shows the balance after the withdrawal.
  await expect(send.getByText(`You have ${formatAmount(held, 'USDC')} in your Fundit account.`)).toBeVisible({ timeout: 30_000 })
  // Max keeps back the estimated prefund for this send. With a fixed 0.05 USDC it reverted with "ERC20: transfer
  // amount exceeds balance", because the EntryPoint takes the prefund (about 0.22 USDC at Circle's fee) before
  // the transfer runs: 0x30f4517f77571103f1358275b1435172c31f746266f07f75df80496bdbceb21c on Arc testnet.
  await send.getByRole('button', { name: 'Max' }).click()
  const field = send.getByRole('textbox', { name: 'Amount' })
  await expect(field).not.toHaveValue('')
  const amount = parseUnits(await field.inputValue(), 6)
  const reserve = held - amount
  console.log(`Max keeps ${formatUnits(reserve, 6)} USDC for the network fee`)
  expect(reserve).toBeGreaterThanOrEqual(50_000n)
  await send.getByLabel('Recipient').fill(funder)
  await send.getByRole('button', { name: 'Send', exact: true }).click()
  await settled(send, 'Your money was sent.')
  logUserOps('Send money out on Arc')

  // The funder got exactly the Max amount. The account paid this send's gas from what it kept.
  expect(await usdcBalance(funder)).toBe(before + amount)
  expect(await usdcBalance(account)).toBeLessThanOrEqual(reserve)
})
