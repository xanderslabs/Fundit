import { type Address, getAddress, parseUnits } from 'viem'
import { ACCOUNTS, approveAndDonate, balanceOf, connect, createCampaign, expect, node, summary, test, tokenAddress } from './fixtures'

const A = ACCOUNTS.creator
const B = ACCOUNTS.donor

test('A creates a USDC campaign, B donates with a tip and message, A withdraws to Arc and closes', async ({ as }) => {
  const usdc = await tokenAddress('USDC')

  // 1. A creates a USDC campaign with a goal of 100 and lands on its page.
  const a = await as(A)
  await a.goto('/create')
  await connect(a, A)
  await a.getByLabel('Title').fill('E2E garden fund')
  await a.getByLabel('Description').fill('Seeds and tools for the community garden.')
  await a.getByLabel('Goal').fill('100')
  await expect(a.getByText('Fundit keeps 1% of each donation.')).toBeVisible()
  await a.getByRole('button', { name: 'Create fundraiser' }).click()
  await expect(a).toHaveURL(/\/c\/0x[0-9a-fA-F]{40}$/)
  const campaign = getAddress(a.url().split('/c/')[1]!) as Address
  await expect(a.getByRole('heading', { level: 1, name: 'E2E garden fund' })).toBeVisible()
  await expect(a.locator('.stats-raised')).toContainText('0.00 USDC')
  await expect(a.locator('.stats-raised')).toContainText('raised of 100.00 USDC goal')
  const created = await summary(campaign)
  expect(getAddress(created.creator)).toBe(getAddress(A))
  expect(created.goal).toBe(parseUnits('100', 6))

  // 2. B donates 10 with a 10% tip (1 USDC) and the message "good luck".
  const b = await as(B)
  await b.goto(`/c/${campaign}`)
  await connect(b, B)
  const donate = b.getByRole('region', { name: 'Donate' })
  await expect(donate.getByText(/Your balance: /)).toBeVisible()
  await donate.getByRole('textbox', { name: 'Amount' }).fill('10')
  await donate.getByLabel('10%').check()
  await donate.getByLabel('Message (optional)').fill('good luck')
  await expect(donate.getByRole('definition').filter({ hasText: '11.00 USDC' })).toBeVisible()
  await donate.getByRole('button', { name: 'Donate', exact: true }).click()
  await expect(donate.getByText('Thank you. Your donation went through.')).toBeVisible()

  const activity = b.getByRole('region', { name: 'Activity' })
  await expect(activity.getByText('good luck', { exact: true })).toBeVisible()
  await expect(activity.getByRole('listitem').first()).toContainText('gave 10.00 USDC and tipped Fundit 1.00 USDC')
  await expect(b.locator('.stats-raised')).toContainText('10.00 USDC')
  const afterDonation = await summary(campaign)
  expect(afterDonation.raised).toBe(parseUnits('10', 6))
  // A 1% donation fee leaves 9.9 for the organiser.
  expect(afterDonation.available).toBe(parseUnits('9.9', 6))

  // 3. A opens Manage and withdraws everything available to Arc.
  await a.reload()
  await connect(a, A)
  await a.getByRole('link', { name: 'Manage fundraiser' }).click()
  await expect(a).toHaveURL(new RegExp(`/manage/${campaign}$`))
  const withdraw = a.getByRole('region', { name: 'Withdraw' })
  await expect(withdraw.getByText('Available: 9.90 USDC')).toBeVisible()
  await withdraw.getByRole('button', { name: 'Max' }).click()
  await expect(withdraw.getByRole('textbox', { name: 'Amount' })).toHaveValue('9.9')
  // 1% withdrawal fee: 9.9 - 0.099 = 9.801.
  const net = parseUnits('9.801', 6)
  await expect(withdraw.getByRole('definition').filter({ hasText: '9.80 USDC' })).toBeVisible()

  // Nothing has been mined since the donation, so the withdrawal is estimated against the donation's block.
  const before = await balanceOf(usdc, A)
  const nativeBefore = await node.getBalance({ address: A })
  const blockBefore = await node.getBlockNumber()
  await withdraw.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await expect(withdraw.getByText('Your withdrawal went through.')).toBeVisible()

  // A pays the network fee in USDC too, so take it out of the expected rise. On Arc the native balance (18
  // decimals) is the USDC balance; the ERC-20 interface reads it with 6 decimals.
  const tip = await node.getBlockNumber()
  let gasWei = 0n
  for (let n = blockBefore + 1n; n <= tip; n++) {
    const block = await node.getBlock({ blockNumber: n, includeTransactions: true })
    for (const tx of block.transactions) {
      if (getAddress(tx.from) !== getAddress(A)) continue
      const receipt = await node.getTransactionReceipt({ hash: tx.hash })
      gasWei += receipt.gasUsed * receipt.effectiveGasPrice
    }
  }
  expect(gasWei).toBeGreaterThan(0n)
  const nativeAfter = await node.getBalance({ address: A })
  expect(nativeAfter).toBe(nativeBefore + net * 10n ** 12n - gasWei)
  const after = await balanceOf(usdc, A)
  expect(after).toBe(nativeAfter / 10n ** 12n)
  expect(after - before).toBeGreaterThan(net - parseUnits('0.01', 6))
  expect(after - before).toBeLessThanOrEqual(net)
  await expect(withdraw.getByText('Available: 0.00 USDC')).toBeVisible()
  expect((await summary(campaign)).available).toBe(0n)

  // 4. A closes the campaign straight after the withdrawal. The confirm dialog is accepted by the fixture.
  await a.getByRole('button', { name: 'Close fundraiser' }).click()
  await expect(a.getByText('The fundraiser is closed.')).toBeVisible()
  expect((await summary(campaign)).closed).toBe(true)

  // The donate panel is disabled for B.
  await b.reload()
  await connect(b, B)
  const closedPanel = b.getByRole('region', { name: 'Donate' })
  await expect(closedPanel.getByText('This campaign is closed.')).toBeVisible()
  await expect(closedPanel.getByRole('textbox', { name: 'Amount' })).toBeDisabled()
  await expect(closedPanel.getByRole('button', { name: 'Donate', exact: true })).toBeDisabled()
})

// Regression: Campaign._activity() skips its two SSTOREs when the last activity is in the current block.
// An estimate made against the latest block prices the withdrawal as if it shared the donation's block,
// about 3,200 gas short. Before the fix the wallet (here the node, for eth_sendTransaction without gas)
// estimated that way, and this withdrawal ran out of gas and reverted, with the organiser paying the fee.
// The app now estimates on the Arc client and sends gas plus 25% (withGasMargin in src/lib/sender.ts).
test('a withdrawal right after a donation in the latest block goes through', async ({ as }) => {
  const campaign = await createCampaign(A, 'USDC', 'E2E same-block fund')
  await approveAndDonate(B, campaign, '10')
  const donationBlock = await node.getBlockNumber()
  const a = await as(A)
  await a.goto(`/manage/${campaign}`)
  await connect(a, A)
  const withdraw = a.getByRole('region', { name: 'Withdraw' })
  await expect(withdraw.getByText('Available: 9.90 USDC')).toBeVisible()
  // Nothing else has been mined: the estimate runs against the donation's block.
  expect(await node.getBlockNumber()).toBe(donationBlock)
  await withdraw.getByRole('button', { name: 'Max' }).click()
  await withdraw.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await expect(withdraw.getByText('Your withdrawal went through.')).toBeVisible()

  const block = await node.getBlock({ blockNumber: donationBlock + 1n, includeTransactions: true })
  const tx = block.transactions.find((t) => getAddress(t.from) === getAddress(A))!
  const receipt = await node.getTransactionReceipt({ hash: tx.hash })
  expect(receipt.status).toBe('success')
  expect((await summary(campaign)).available).toBe(0n)
})
