import { expect, type Page, test } from '@playwright/test'
import type { Address } from 'viem'
import { campaignAbi } from '../src/abi/campaign'
import { factoryAbi } from '../src/abi/factory'
import { arc, checkChain, checkEnv, NET } from './arc'

// Review and removed states, and the Fundit report form. It sends no transactions: it only reads the factory,
// and it stubs /api/moderation and /api/report, because the e2e server is Vite alone and has no Worker.
const FUNDIT_CATEGORIES = [
  'Fake or a scam',
  'Pretending to be someone else',
  'Misusing the money',
  'Harmful or illegal content',
  'I organise this Fundit and want to respond',
  'Something else about this Fundit',
]

let fundit: Address
let title: string

// A Fundit the app lists publicly: not made by a test creator. Read from the factory, not from the first card.
test.beforeAll(async () => {
  const { factory } = checkEnv()
  await checkChain()
  const count = await arc.readContract({ address: factory, abi: factoryAbi, functionName: 'campaignCount' })
  const all = await arc.readContract({ address: factory, abi: factoryAbi, functionName: 'getCampaigns', args: [0n, count] })
  for (const address of all) {
    const s = await arc.readContract({ address, abi: campaignAbi, functionName: 'summary' })
    if (NET.testCreators.includes(s.creator.toLowerCase())) continue
    fundit = address
    title = s.meta.title
    return
  }
  throw new Error('No testnet Fundit made by a non-test creator. Make one, then run again.')
})

const card = (page: Page) => page.locator(`a.fundit-card[href="/c/${fundit}" i]`)

function stubModeration(page: Page, state: 'normal' | 'review' | 'removed' | 503) {
  return page.route('**/api/moderation', (route) => {
    if (state === 503) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    const body = { review: state === 'review' ? [fundit.toLowerCase()] : [], removed: state === 'removed' ? [fundit.toLowerCase()] : [] }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('a Fundit with no flag is on Home and Explore', async ({ page }) => {
  await stubModeration(page, 'normal')
  await page.goto('/explore')
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
  await page.goto('/')
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
})

test('a Fundit under review leaves Home and Explore, and its page shows the banner to a signed-out visitor', async ({ page }) => {
  await stubModeration(page, 'review')
  await page.goto('/explore')
  // Wait for the list to load with another Fundit on it, so a missing card is not just a slow load.
  await expect(page.locator('a.fundit-card').first()).toBeVisible({ timeout: 60_000 })
  await expect(card(page)).toHaveCount(0)
  // Home lists the same Fundits (the previous test shows this one there), so wait for another card first.
  await page.goto('/')
  await expect(page.locator('a.fundit-card').first()).toBeVisible({ timeout: 60_000 })
  await expect(card(page)).toHaveCount(0)

  await page.goto(`/c/${fundit}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('This Fundit is under review.')).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

test('a removed Fundit shows the removed notice and no Give panel', async ({ page }) => {
  await stubModeration(page, 'removed')
  await page.goto(`/c/${fundit}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Fundit removed this fundraiser from the site after a review.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Give' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Give', exact: true })).toHaveCount(0)
})

test('when /api/moderation fails the Fundit is back on Explore and its page has no banner', async ({ page }) => {
  await stubModeration(page, 503)
  await page.goto('/explore')
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
  await card(page).click()
  await expect(page).toHaveURL(new RegExp(`/c/${fundit}$`, 'i'))
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Give' })).toBeVisible()
  await expect(page.getByText('This Fundit is under review.')).toHaveCount(0)
  await expect(page.getByText('Fundit removed this fundraiser from the site after a review.')).toHaveCount(0)
})

test('Report this Fundit opens the form with the six categories and sends the Fundit address', async ({ page }) => {
  // The form renders only with a Turnstile site key, and the dev server here has none in its env. Stand in for
  // the Turnstile script with one that gives a token at once. The app code is unchanged. The key itself is set
  // for the dev server in playwright.config.ts, and /api/report is stubbed, so no token is ever checked.
  await page.addInitScript(() => {
    ;(window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: unknown, o: { callback: (t: string) => void }) => {
        o.callback('e2e-token')
        return 'e2e-widget'
      },
      reset: () => {},
      remove: () => {},
    }
  })
  await stubModeration(page, 'normal')
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/report', (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  await page.goto(`/c/${fundit}`)
  await page.getByRole('link', { name: 'Report this Fundit' }).click()
  await expect(page).toHaveURL(new RegExp(`/report\\?fundit=${fundit}$`, 'i'))
  await expect(page.getByText(`Reporting: ${title}`)).toBeVisible({ timeout: 30_000 })
  const options = await page.getByLabel('What is it about?').locator('option').allInnerTexts()
  expect(options).toEqual(FUNDIT_CATEGORIES)

  await page.getByLabel('What happened').fill('This is an e2e check. No real report.')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText("Thanks. We read every report. If you left an email, we'll reply there.")).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(String(sent[0]!.fundit).toLowerCase()).toBe(fundit.toLowerCase())
  expect(sent[0]!.category).toBe(FUNDIT_CATEGORIES[0])
})
