import { expect, type Page, test } from '@playwright/test'
import { type Address, formatUnits, getAddress, parseUnits } from 'viem'
import { campaignAbi } from '../src/abi/campaign'
import { MULTICALL3_FROM } from '../src/config'
import { arc, checkChain, checkEnv, fundFromFunder, funderAddress, logTx, NET, txUrl, usdcBalance } from './arc'
import { installTestWallet, type TestWallet, WALLET_NAME } from './wallet'

// Wallet sign-in end to end, with no passkey: a test wallet (a fresh local key in this Node process, announced to
// the page through EIP-6963) signs in, starts a Fundit, gives to it and sends money out. It runs on localhost
// before a deploy as well as on fundit.fun. A fresh account per run is funded with 0.1 USDC and what is left goes
// back to the funder at the end.
test.describe.configure({ mode: 'serial' })

const FUNDING = parseUnits('0.1', 6)
const GIFT = '0.01'
const SEND_OUT = '0.01'
const TITLE = `E2E wallet fund ${new Date().toISOString().slice(0, 19)}`

let page: Page
let wallet: TestWallet
let funder: Address
let funderStart: bigint
let campaign: Address
const wcSeen: string[] = []
const netLog: string[] = []
let step = 'start'

test.beforeAll(async ({ browser }) => {
  checkEnv()
  await checkChain()
  funder = funderAddress()
  funderStart = await usdcBalance(funder)
  expect(funderStart, 'the funder needs testnet USDC from https://faucet.circle.com').toBeGreaterThan(FUNDING + parseUnits('0.1', 6))
  console.log(`Funder ${funder} holds ${formatUnits(funderStart, 6)} USDC`)

  const context = await browser.newContext()
  page = await context.newPage()
  wallet = await installTestWallet(page, arc)
  console.log(`Test wallet ${wallet.address}: ${NET.explorerUrl}/address/${wallet.address}`)
  // Every request and WebSocket the page opens, to see when it first talks to WalletConnect.
  const note = (kind: string, url: string) => {
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      // Not a URL (data: and the like).
    }
    netLog.push(`${kind} ${host}`)
    if (/walletconnect|reown|web3modal/i.test(host)) wcSeen.push(`[${step}] ${kind} ${url.replace(/projectId=[^&]+/i, 'projectId=...')}`)
  }
  page.on('request', (r) => note('request', r.url()))
  page.on('websocket', (ws) => note('websocket', ws.url()))
  page.on('dialog', (d) => {
    console.log(`dialog: ${d.message()}`)
    void d.accept()
  })
})

test.afterAll(async () => {
  await page?.context().close()
  if (!wallet) return
  console.log(`Hosts the page talked to: ${[...new Set(netLog.map((l) => l.split(' ')[1]))].filter(Boolean).sort().join(', ')}`)
  console.log(`WalletConnect traffic seen: ${wcSeen.length === 0 ? 'none' : ''}`)
  for (const line of wcSeen) console.log(`  ${line}`)
  for (const { hash } of wallet.sent) {
    const r = await arc.getTransactionReceipt({ hash })
    console.log(`Fee ${formatUnits((r.gasUsed * r.effectiveGasPrice) / 10n ** 12n, 6)} USDC (gas ${r.gasUsed}): ${txUrl(hash)}`)
  }
  console.log(`Wallet requests: ${wallet.requests.join(', ')}`)
  const left = await usdcBalance(wallet.address)
  console.log(`Test wallet holds ${formatUnits(left, 6)} USDC at the end`)
  if (funderStart !== undefined) console.log(`Funder spent ${formatUnits(funderStart - (await usdcBalance(funder)), 6)} USDC this run`)
})

test('funds the wallet and signs in with it', async () => {
  const hash = await fundFromFunder(wallet.address, FUNDING)
  logTx('Fund the test wallet', hash)
  expect(await usdcBalance(wallet.address)).toBe(FUNDING)

  step = 'before sign in'
  await page.goto('/')
  // Nothing has talked to WalletConnect yet: the wallet code is not loaded.
  step = 'sign in dialog'
  await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Connect a wallet' }).click()
  step = 'wallet list shown'
  const wallets = page.getByRole('list', { name: 'Wallets in this browser' })
  await expect(wallets.getByRole('button', { name: WALLET_NAME })).toBeVisible()
  step = 'wallet picked'
  await wallets.getByRole('button', { name: WALLET_NAME }).click()
  step = 'signed in'
  // The pill shows the short address, and the wallet was moved to Arc.
  const short = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
  await expect(page.getByRole('banner').getByRole('button', { name: short })).toBeVisible({ timeout: 30_000 })
  expect(wallet.requests).toContain('wallet_switchEthereumChain')
})

test('starts a Fundit from the wallet', async () => {
  step = 'create'
  await page.getByRole('banner').getByRole('button', { name: new RegExp(wallet.address.slice(0, 6)) }).click()
  await page.getByRole('menuitem', { name: 'Start a Fundit' }).click()
  await expect(page).toHaveURL(/\/create$/)
  await page.getByLabel('Title').fill(TITLE)
  await page.getByLabel('Description').fill('Seeds and tools for the community garden. Made by the e2e suite.')
  await page.getByLabel('Goal').fill('10')
  await page.getByRole('button', { name: 'Create a Fundit' }).click()
  const live = page.getByRole('heading', { level: 1, name: 'Your Fundit is live' })
  const failed = page.locator('.create-status .status-error')
  await expect(live.or(failed)).toBeVisible({ timeout: 90_000 })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.innerText()}`)
  const href = await page.getByRole('link', { name: 'Go to your Fundit' }).getAttribute('href')
  campaign = getAddress(href!.split('/c/')[1]!)
  console.log(`Fundit ${campaign}: ${NET.explorerUrl}/address/${campaign}`)
  const created = wallet.sent.at(-1)!
  logTx('Create a Fundit', created.hash)
})

test('gives to it: one transaction to Multicall3From', async () => {
  step = 'give'
  await page.getByRole('link', { name: 'Go to your Fundit' }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${campaign}$`))
  const give = page.getByRole('region', { name: 'Give' })
  await give.getByRole('textbox', { name: 'Amount' }).fill(GIFT)
  await expect(give.getByRole('group', { name: 'Tip Fundit (optional)' }).getByRole('radio', { name: '0%', exact: true })).toBeChecked()
  const sentBefore = wallet.sent.length
  await give.getByRole('button', { name: 'Give', exact: true }).click()
  const done = give.getByText('Thank you. Your donation went through.')
  const failed = give.locator('.status-error')
  await expect(done.or(failed).first()).toBeVisible({ timeout: 90_000 })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.first().innerText()}`)

  // Approve and donate go out as one transaction to Multicall3From, from the test address.
  expect(wallet.sent.length - sentBefore).toBe(1)
  const { hash } = wallet.sent.at(-1)!
  logTx('Give', hash)
  const shown = await give.getByRole('link', { name: 'View it on the Arc explorer' }).getAttribute('href')
  expect(shown).toBe(txUrl(hash))
  const tx = await arc.getTransaction({ hash })
  expect(getAddress(tx.to!)).toBe(getAddress(MULTICALL3_FROM))
  expect(getAddress(tx.from)).toBe(wallet.address)
  const receipt = await arc.getTransactionReceipt({ hash })
  expect(receipt.status).toBe('success')
  const summary = await arc.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })
  expect(summary.raised).toBe(parseUnits(GIFT, 6))
})

test('sends money out, signs out, and returns the rest to the funder', async () => {
  step = 'send'
  await page.getByRole('banner').getByRole('button', { name: new RegExp(wallet.address.slice(0, 6)) }).click()
  await page.getByRole('menuitem', { name: 'My page' }).click()
  await page.getByRole('region', { name: 'Your Fundit account' }).getByRole('button', { name: 'Send' }).click()
  const send = page.getByRole('region', { name: 'Send money out' })
  const before = await usdcBalance(funder)
  await expect(send.getByText(/^You have \d/)).toBeVisible({ timeout: 30_000 })
  await send.getByRole('textbox', { name: 'Amount' }).fill(SEND_OUT)
  await send.getByLabel('Recipient').fill(funder)
  const sentBefore = wallet.sent.length
  await send.getByRole('button', { name: 'Send', exact: true }).click()
  const done = send.getByText('Your money was sent.')
  const failed = send.locator('.status-error')
  await expect(done.or(failed).first()).toBeVisible({ timeout: 90_000 })
  if (await failed.count()) throw new Error(`The page shows an error: ${await failed.first().innerText()}`)
  expect(wallet.sent.length - sentBefore).toBe(1)
  logTx('Send money out', wallet.sent.at(-1)!.hash)
  expect(await usdcBalance(funder)).toBe(before + parseUnits(SEND_OUT, 6))

  step = 'sign out'
  await page.getByRole('banner').getByRole('button', { name: new RegExp(wallet.address.slice(0, 6)) }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  // What is left goes back, minus the gas of that transfer.
  step = 'return funds'
  const back = await wallet.returnTo(funder)
  if (back) logTx('Return what is left to the funder', back)
  console.log(`Test wallet keeps ${formatUnits(await usdcBalance(wallet.address), 6)} USDC`)
})
