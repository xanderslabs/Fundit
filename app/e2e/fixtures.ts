import { type BrowserContext, expect, type Page, test as base } from '@playwright/test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  parseUnits,
} from 'viem'
import { arc } from 'viem/chains'
import { campaignAbi } from '../src/abi/campaign'
import { factoryAbi } from '../src/abi/factory'
import { ACCOUNTS, LOCAL_RPC, rpc, USDC_WEI } from './fork'

export { ACCOUNTS, rpc, USDC_WEI }

const chain = { ...arc, rpcUrls: { default: { http: [LOCAL_RPC] } } }
// cacheTime 0: specs compare block numbers right after a transaction, and viem caches them for 4 s by default.
export const node = createPublicClient({ chain, transport: http(LOCAL_RPC), cacheTime: 0 })

export const FACTORY = getAddress(process.env.E2E_FACTORY ?? '')

export async function tokenAddress(symbol: 'USDC' | 'EURC'): Promise<Address> {
  return node.readContract({ address: FACTORY, abi: factoryAbi, functionName: symbol === 'USDC' ? 'usdc' : 'eurc' })
}

export async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  return node.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}

// Sends from an account the fork has unlocked (anvil default accounts, or one being impersonated).
export async function send(from: Address, to: Address, data: Hex): Promise<Hex> {
  const wallet = createWalletClient({ chain, transport: http(LOCAL_RPC), account: from })
  const hash = await wallet.sendTransaction({ to, data })
  const receipt = await node.waitForTransactionReceipt({ hash })
  expect(receipt.status).toBe('success')
  return hash
}

// Creates a campaign straight on the fork, for specs that are not about the create form.
export async function createCampaign(creator: Address, symbol: 'USDC' | 'EURC', title: string, goal = '100'): Promise<Address> {
  const token = await tokenAddress(symbol)
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: 'createCampaign',
    args: [token, parseUnits(goal, 6), '0x0000000000000000000000000000000000000000', { title, description: '', imageUrl: '', links: [] }],
  })
  const hash = await send(creator, FACTORY, data)
  const receipt = await node.getTransactionReceipt({ hash })
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: factoryAbi, topics: log.topics, data: log.data })
      if (event.eventName === 'CampaignCreated') return event.args.campaign
    } catch {
      // Not a factory event.
    }
  }
  throw new Error('CampaignCreated not found')
}

// Donates on the fork without the UI: approve, then donate(amount, 0, '').
export async function approveAndDonate(donor: Address, campaign: Address, amount: string): Promise<void> {
  const token = await tokenAddress('USDC')
  const value = parseUnits(amount, 6)
  await send(donor, token, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [campaign, value] }))
  await send(donor, campaign, encodeFunctionData({ abi: campaignAbi, functionName: 'donate', args: [value, 0n, ''] }))
}

export async function summary(campaign: Address) {
  return node.readContract({ address: campaign, abi: campaignAbi, functionName: 'summary' })
}

// Hosts the app may call, all stubbed so no spec touches the internet. Anything else fails the test.
const NAME_RPC_HOSTS = new Set(['ethereum-rpc.publicnode.com', 'mainnet.base.org'])
const IRIS_HOST = 'iris-api.circle.com'
const GATEWAY_HOST = 'gateway-api.circle.com'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

type JsonRpcRequest = { id: number | string; method: string }

// ENS and Basename lookups get empty answers, so every name falls back to the short address.
function emptyRpcAnswer(body: string | null): string {
  const parsed = JSON.parse(body ?? '{}') as JsonRpcRequest | JsonRpcRequest[]
  const answer = (r: JsonRpcRequest) =>
    r.method === 'eth_call'
      ? { jsonrpc: '2.0', id: r.id, result: '0x' }
      : { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'stubbed in e2e' } }
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed))
}

async function guard(context: BrowserContext, blocked: string[]): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (LOCAL_HOSTS.has(url.hostname)) return route.continue()
    if (NAME_RPC_HOSTS.has(url.hostname)) {
      return route.fulfill({ contentType: 'application/json', body: emptyRpcAnswer(route.request().postData()) })
    }
    // Iris answers 404 until it has seen a burn. Specs that need an answer add their own route.
    if (url.hostname === IRIS_HOST) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    if (url.hostname === GATEWAY_HOST) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    blocked.push(url.href)
    return route.abort('blockedbyclient')
  })
}

type Actors = {
  // A page whose wallet (the mock connector) is the given unlocked fork account.
  as(account: Address): Promise<Page>
}

export const test = base.extend<Actors>({
  as: async ({ browser }, use) => {
    const contexts: BrowserContext[] = []
    const blocked: string[] = []
    await use(async (account) => {
      const context = await browser.newContext()
      contexts.push(context)
      await guard(context, blocked)
      await context.addInitScript((a) => localStorage.setItem('fundit.e2e.account', a), account)
      const page = await context.newPage()
      page.on('dialog', (d) => void d.accept())
      return page
    })
    for (const c of contexts) await c.close()
    expect(blocked, 'requests to hosts that are neither local nor stubbed').toEqual([])
  },
})

export { expect }

// Signs in with the mock wallet through the top bar's Sign in if the page is not already connected (it
// reconnects by itself after a reload), then checks the header shows the account pill.
export async function connect(page: Page, account: Address): Promise<void> {
  const banner = page.getByRole('banner')
  const connectButton = banner.getByRole('button', { name: 'Sign in' })
  const accountButton = banner.getByRole('button', { name: `${account.slice(0, 6)}...${account.slice(-4)}` })
  await expect(connectButton.or(accountButton)).toBeVisible()
  if (await connectButton.isVisible()) await connectButton.click()
  await expect(accountButton).toBeVisible()
}
