import { type Address, encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { ACCOUNTS, connect, createCampaign, expect, rpc, send, summary, test, tokenAddress, USDC_WEI } from './fixtures'

// Any address works as the holder: on Arc, setting its native balance gives it USDC.
const HOLDER: Address = '0x00000000000000000000000000000000c0FFee01'
const BASE_DOMAIN = 6
const BURN_TX = `0x${'ab'.repeat(32)}` as const
const FORWARD_TX = `0x${'cd'.repeat(32)}` as const

test('a stubbed CCTP mint shows in raised, and as a cross-chain donation once settled', async ({ as }) => {
  const usdc = await tokenAddress('USDC')
  const campaign = await createCampaign(ACCOUNTS.creator, 'USDC', 'E2E cross-chain fund')

  // The donor's browser remembers a burn on Base that is on its way to this campaign.
  const page = await as(ACCOUNTS.donor)
  await page.addInitScript(
    ([c, burnTx, srcDomain]) =>
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'bridge', campaign: c, burnTx, srcDomain, amount: '5', createdAt: Date.now() }]),
      ),
    [campaign, BURN_TX, BASE_DOMAIN] as const,
  )
  // Iris reports the forwarding service minted it on Arc.
  let irisCalls = 0
  await page.route('https://iris-api.circle.com/v2/messages/**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.pathname).toBe(`/v2/messages/${BASE_DOMAIN}`)
    expect(url.searchParams.get('transactionHash')).toBe(BURN_TX)
    irisCalls++
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ messages: [{ status: 'complete', forwardTxHash: FORWARD_TX }] }),
    })
  })

  // Simulate the mint: 5 USDC lands on the campaign from a funded, impersonated holder, with no donate() call.
  await rpc('anvil_setBalance', [HOLDER, `0x${(10n * USDC_WEI).toString(16)}`])
  await rpc('anvil_impersonateAccount', [HOLDER])
  await send(HOLDER, usdc, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [campaign, parseUnits('5', 6)] }))
  await rpc('anvil_stopImpersonatingAccount', [HOLDER])

  await page.goto(`/c/${campaign}`)
  await connect(page, ACCOUNTS.donor)
  await expect(page.getByText('5 USDC from Base reached the campaign.')).toBeVisible()
  expect(irisCalls).toBeGreaterThan(0)
  // raised() counts unaccounted funds, so the total is right before anyone settles.
  await expect(page.locator('.stats-raised')).toContainText('5.00 USDC')
  const activity = page.getByRole('region', { name: 'Activity' })
  await expect(activity.getByText('No activity yet.')).toBeVisible()
  await expect(activity.getByText(/Cross-chain donation/)).toHaveCount(0)
  // The list says the inflow is there but not booked yet, so it does not look missing.
  await expect(activity.getByText('5.00 USDC from other chains, not counted yet')).toBeVisible()

  // Anyone can call settle(). The donor's wallet does it from the activity list, and it books the inflow as
  // an ExternalDonationSettled event.
  await activity.getByRole('button', { name: 'Count it now' }).click()
  await expect(activity.getByText('Counted. It now shows in the list.')).toBeVisible()
  await expect(activity.getByText('Cross-chain donation of 5.00 USDC')).toBeVisible()
  await expect(activity.getByText(/not counted yet/)).toHaveCount(0)
  const settled = await summary(campaign)
  expect(settled.raised).toBe(parseUnits('5', 6))
  // 1% donation fee on the settled amount.
  expect(settled.available).toBe(parseUnits('4.95', 6))

  await page.reload()
  await expect(activity.getByText('Cross-chain donation of 5.00 USDC')).toBeVisible()
  await expect(page.locator('.stats-raised')).toContainText('5.00 USDC')
})

test('an EURC campaign offers only "Arc wallet" in the donate panel', async ({ as }) => {
  const campaign = await createCampaign(ACCOUNTS.creator, 'EURC', 'E2E euro fund')
  const page = await as(ACCOUNTS.donor)
  await page.goto(`/c/${campaign}`)
  await connect(page, ACCOUNTS.donor)

  const donate = page.getByRole('region', { name: 'Donate' })
  await expect(donate.getByText(/Your balance: .* EURC/)).toBeVisible()
  const sources = donate.getByRole('group', { name: 'Pay with' }).getByRole('radio')
  await expect(sources).toHaveCount(1)
  await expect(donate.getByRole('radio', { name: /^Arc wallet/ })).toBeChecked()
  await expect(donate.getByText('USDC on another chain')).toHaveCount(0)
  await expect(donate.getByText('Unified USDC balance')).toHaveCount(0)
  await expect(donate.getByText('EURC campaigns accept donations on Arc only.')).toBeVisible()
})

test('with VITE_CROSSCHAIN off, a USDC campaign offers only "Arc wallet" to a connected wallet', async ({ as }) => {
  // The e2e build uses the production default, cross-chain donations off. DonatePanel.test.tsx covers the
  // flag on, where a connected wallet gets all three sources.
  const campaign = await createCampaign(ACCOUNTS.creator, 'USDC', 'E2E dollar fund')
  const page = await as(ACCOUNTS.donor)
  await page.goto(`/c/${campaign}`)
  await connect(page, ACCOUNTS.donor)
  const donate = page.getByRole('region', { name: 'Donate' })
  await expect(donate.getByText(/Your balance: .* USDC/)).toBeVisible()
  const sources = donate.getByRole('group', { name: 'Pay with' }).getByRole('radio')
  await expect(sources).toHaveCount(1)
  await expect(donate.getByRole('radio', { name: /^Arc wallet/ })).toBeChecked()
})
