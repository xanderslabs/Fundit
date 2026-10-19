import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { type Address, formatUnits, getAddress, type Hex, pad, parseAbi, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { campaignAbi } from '../src/abi/campaign'
import { factoryAbi } from '../src/abi/factory'
import { CIRCLE_MULTISIG_PLUGIN, storageKey } from '../src/config'
import { formatAmount } from '../src/lib/format'
import { arc, checkChain, checkEnv, fundFromFunder, funderAddress, loadSharedPasskey, logTx, NET, txUrl, usdcBalance } from './arc'
import { addVirtualAuthenticator } from './passkey'
import { checkRpId, type SharedPasskey, topUpFor } from './sharedPasskey'

// One shared Fundit account (app/.env.testnet.passkey, made once by npm run e2e:make-account) goes through every
// journey in order. Reusing it keeps Circle's count of active wallets low. The page, its virtual passkey and the
// account carry over from test to test: a failed step skips the rest. The account keeps its money, Fundits and
// recovery key from earlier runs, so each step works from whatever state it finds.
test.describe.configure({ mode: 'serial' })

// What the account should hold when a run starts. The funder tops it up to this, never more. A run spends the gas
// of four user operations (create, give, withdraw, send, about 1.1 USDC at Circle's bundler prices), the 1% fees on
// the gift, and SEND_OUT, and each send needs its estimated prefund on hand. The first recovery key also deploys
// the account, which costs about 1 USDC more.
const RUN_BUDGET = parseUnits('2', 6)
const FIRST_KEY_BUDGET = parseUnits('1.2', 6)
const GIFT = '0.2'
// Sent back to the funder at the end. A fixed amount, not Max, so the account keeps its balance for the next run.
const SEND_OUT = '0.1'
const MESSAGE = 'Good luck from the e2e run'
// Each run makes a new Fundit. The title names the run, so My page finds this run's Fundit among earlier ones.
const TITLE = `E2E testnet garden fund ${new Date().toISOString().slice(0, 19)}`

const ownershipAbi = parseAbi([
  'struct OwnerData { uint256 weight; uint8 credType; address addr; uint256 publicKeyX; uint256 publicKeyY; }',
  'function ownershipInfoOf(address account) view returns (bytes30[] ownerIds, OwnerData[] ownersData, uint256 thresholdWeight)',
])

let context: BrowserContext
let page: Page
let passkeys: Awaited<ReturnType<typeof addVirtualAuthenticator>>
let shared: SharedPasskey
let factory: Address
let account: Address
let username: string
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

// True once a recovery key is an owner of the account next to the passkey.
async function recoveryKeySaved(who: Address): Promise<boolean> {
  const [ownerIds] = await arc.readContract({ address: CIRCLE_MULTISIG_PLUGIN, abi: ownershipAbi, functionName: 'ownershipInfoOf', args: [who] })
  return ownerIds.length >= 2
}

async function openMenuItem(name: string) {
  // The account pill shows the passkey username chosen at sign-up.
  await page.getByRole('banner').getByRole('button', { name: username, exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}

test.beforeAll(async ({ browser }) => {
  factory = checkEnv().factory
  shared = loadSharedPasskey()
  checkRpId(shared, test.info().project.use.baseURL!)
  account = getAddress(shared.account)
  username = shared.username
  // The run makes a Fundit. Its creator must be on the testnet test-creator list, so it stays off Home and Explore.
  if (!NET.testCreators.includes(account.toLowerCase())) {
    throw new Error(`Add the shared e2e account ${account} (lower case) to testCreators for testnet in src/config.ts.`)
  }
  await checkChain()
  funder = funderAddress()
  funderStart = await usdcBalance(funder)
  console.log(`Funder ${funder} holds ${formatUnits(funderStart, 6)} USDC`)
  console.log(`Shared Fundit account ${account} holds ${formatUnits(await usdcBalance(account), 6)} USDC: ${NET.explorerUrl}/address/${account}`)
  fromBlock = await arc.getBlockNumber()

  context = await browser.newContext()
  // The account pill shows the passkey's username when this browser knows it. Sign-up saved it; sign-in does not.
  await context.addInitScript(([key, name]) => localStorage.setItem(key!, name!), [storageKey('passkey.username.', 'testnet') + account.toLowerCase(), username])
  page = await context.newPage()
  passkeys = await addVirtualAuthenticator(page)
  await passkeys.addStored(shared)
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

test('signs in with the shared passkey', async () => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Sign in with your passkey' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: username, exact: true })).toBeVisible({ timeout: 60_000 })

  // My page shows the account the passkey opens. It must be the shared one.
  await openMenuItem('My page')
  await expect(page).toHaveURL(/\/me$/)
  await page.getByRole('region', { name: 'Your Fundit account' }).getByRole('button', { name: 'Add money' }).click()
  const panel = page.getByRole('region', { name: 'Add money' })
  await expect(panel.getByRole('tab', { name: 'Your address' })).toHaveAttribute('aria-selected', 'true')
  const shown = /0x[0-9a-fA-F]{40}/.exec(await panel.getByRole('tabpanel', { name: 'Your address' }).innerText())?.[0]
  expect(shown && getAddress(shown)).toBe(account)

  // The one passkey on the virtual authenticator is the stored one, bound to the site's hostname.
  const creds = await passkeys.credentials()
  expect(creds).toHaveLength(1)
  expect(creds[0]!.rpId).toBe(new URL(page.url()).hostname)
})

test('adds money: the funder tops the account up to what the run needs', async () => {
  const before = await usdcBalance(account)
  const budget = RUN_BUDGET + ((await recoveryKeySaved(account)) ? 0n : FIRST_KEY_BUDGET)
  const topUp = topUpFor(before, budget)
  if (topUp > 0n) {
    expect(funderStart, 'the funder needs testnet USDC from https://faucet.circle.com').toBeGreaterThan(topUp + parseUnits('0.1', 6))
    const hash = await fundFromFunder(account, topUp)
    logTx('Add money (funder transfer)', hash)
  } else {
    console.log(`No top-up needed: the account holds ${formatUnits(before, 6)} USDC`)
  }
  const now = await usdcBalance(account)
  expect(now).toBeGreaterThanOrEqual(budget)
  // The balance card polls every 15 seconds.
  const card = page.getByRole('region', { name: 'Your Fundit account' })
  const usdc = card.locator('.dash-balances div', { hasText: 'USDC' }).locator('dd')
  await expect(usdc).toHaveText(formatAmount(now, 'USDC').split(' ')[0]!, { timeout: 45_000 })
  // The Add money button closes the panel and opens it again. The address bar follows.
  const addMoney = card.getByRole('button', { name: 'Add money' })
  await expect(addMoney).toHaveAttribute('aria-expanded', 'true')
  await addMoney.click()
  await expect(page.getByRole('region', { name: 'Add money' })).toBeHidden()
  await expect(page).toHaveURL(/\/me$/)
  await addMoney.click()
  await expect(page).toHaveURL(/\/me\?add=1$/)
  const panel = page.getByRole('region', { name: 'Add money' })
  await panel.getByRole('tab', { name: 'From a wallet' }).click()
  await expect(panel.getByRole('tabpanel', { name: 'From a wallet' })).toBeVisible()
  await panel.getByRole('tab', { name: 'Your address' }).click()
})

test('saves the recovery key after confirming three words, or shows it saved', async () => {
  await openMenuItem('My page')
  await expect(page).toHaveURL(/\/me$/)
  const banner = page.getByRole('region', { name: 'Recovery key', exact: true })
  // An earlier run saved it: My page reads the owners on Arc, asks for nothing and says it is saved.
  if (await recoveryKeySaved(account)) {
    console.log('The recovery key was saved by an earlier run')
    await page.getByRole('tab', { name: 'Account' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Account' }).getByText('Recovery key saved')).toBeVisible({ timeout: 30_000 })
    await expect(banner).toHaveCount(0)
    return
  }
  // The banner shows until the chain has a recovery key on the account. Save now opens the recovery key flow.
  await expect(banner.getByText('Save a recovery key so you never lose this account')).toBeVisible()
  await banner.getByRole('button', { name: 'Save now' }).click()
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
  expect(ownerIds.length).toBeGreaterThanOrEqual(2)
  expect(owners.map((o) => o.addr.toLowerCase())).toContain(recovery.toLowerCase())
  await expect(banner).toHaveCount(0)
  await page.getByRole('tab', { name: 'Account' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Account' }).getByText('Recovery key saved')).toBeVisible()
})

test('creates a Fundit', async () => {
  await openMenuItem('Start a Fundit')
  await expect(page).toHaveURL(/\/create$/)
  await page.getByLabel('Title').fill(TITLE)
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
  // No tip (0%): the gift checks below expect a zero tip.
  await expect(give.getByRole('group', { name: 'Tip Fundit (optional)' }).getByRole('radio', { name: '0%', exact: true })).toBeChecked()
  await give.getByRole('switch', { name: 'Hide my name' }).check()
  await expect(give.getByText(`${new TextEncoder().encode(MESSAGE).length} of 274 bytes`)).toBeVisible()
  // The account's real reserve estimate, shown as the most the network fee can take.
  await expect(give.getByLabel('Breakdown').getByText(/^up to \d+\.\d+ USDC$/)).toBeVisible()
  await give.getByRole('button', { name: 'Give', exact: true }).click()
  await settled(give, 'Thank you. Your donation went through.')
  const shownLink = await give.getByRole('link', { name: 'View it on the Arc explorer' }).getAttribute('href')
  const [tx] = logUserOps('Give anonymously')
  expect(shownLink).toBe(txUrl(tx!))

  const activity = page.getByRole('region', { name: 'Activity on this Fundit' })
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

test('My page lists the Fundit and the gift, labelled Given with name hidden', async () => {
  await openMenuItem('My page')
  await expect(page).toHaveURL(/\/me$/)
  const fundits = page.getByRole('tabpanel', { name: 'Your Fundits' })
  await expect(fundits.getByRole('link', { name: `Manage ${TITLE}` })).toHaveAttribute('href', `/manage/${campaign}`)
  await page.getByRole('tab', { name: 'Your gifts' }).click()
  const gifts = page.getByRole('tabpanel', { name: 'Your gifts' })
  const row = gifts.getByRole('listitem').filter({ hasText: TITLE })
  await expect(row).toContainText(`You gave ${formatAmount(parseUnits(GIFT, 6), 'USDC')} to ${TITLE}`, { timeout: 30_000 })
  await expect(row.getByText('Given with name hidden', { exact: true })).toBeVisible()
  await expect(row.getByText(MESSAGE, { exact: true })).toBeVisible()
  await expect(gifts.getByText(/\[anon\]/)).toHaveCount(0)
})

test('sends money out on Arc back to the funder', async () => {
  await expect(page).toHaveURL(/\/me$/)
  // Send opens the Send money out panel under the balance card.
  await page.getByRole('region', { name: 'Your Fundit account' }).getByRole('button', { name: 'Send' }).click()
  await expect(page).toHaveURL(/\/me\?send=1$/)
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
  const reserve = held - parseUnits(await field.inputValue(), 6)
  console.log(`Max keeps ${formatUnits(reserve, 6)} USDC for the network fee`)
  expect(reserve).toBeGreaterThanOrEqual(50_000n)
  // The shared account keeps the rest for the next run, so only SEND_OUT goes back.
  await field.fill(SEND_OUT)
  await send.getByLabel('Recipient').fill(funder)
  await send.getByRole('button', { name: 'Send', exact: true }).click()
  await settled(send, 'Your money was sent.')
  logUserOps('Send money out on Arc')

  // The funder got exactly SEND_OUT. The account paid this send's gas on top.
  const amount = parseUnits(SEND_OUT, 6)
  expect(await usdcBalance(funder)).toBe(before + amount)
  expect(await usdcBalance(account)).toBeLessThan(held - amount)
})
