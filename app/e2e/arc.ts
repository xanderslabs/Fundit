import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'
import { type Address, createPublicClient, createWalletClient, erc20Abi, getAddress, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadEnv } from 'vite'
import { NETWORKS } from '../src/config'
import { PASSKEY_FILE, parseSharedPasskey, type SharedPasskey } from './sharedPasskey'

// Node side of the suite: reads Arc testnet and sends from the funder. Every value comes from NETWORKS in
// src/config.ts and from app/.env.local, the same file the dev server reads.
export const NET = NETWORKS.testnet
export const USDC = NET.usdc

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
export const FUNDER_FILE = '.env.testnet.funder'

// The dev server runs in development mode, so this is the env the page sees.
const env = loadEnv('development', APP_DIR, 'VITE_')

// Refuses to run against anything but Arc testnet, so the suite can never spend on mainnet.
export function checkEnv(): { factory: Address; deployBlock: bigint } {
  if (env.VITE_ARC_NETWORK !== 'testnet') {
    throw new Error('The e2e suite runs on Arc testnet only. Set VITE_ARC_NETWORK=testnet in app/.env.local.')
  }
  // A live site (E2E_BASE_URL) uses its own client key. Only the local dev server needs the localhost one.
  if (!process.env.E2E_BASE_URL && !env.VITE_CIRCLE_CLIENT_KEY) {
    throw new Error('Set VITE_CIRCLE_CLIENT_KEY (the localhost client key) in app/.env.local.')
  }
  if (!env.VITE_FACTORY_ADDRESS || !env.VITE_FACTORY_DEPLOY_BLOCK) {
    throw new Error('Set VITE_FACTORY_ADDRESS and VITE_FACTORY_DEPLOY_BLOCK (the testnet factory) in app/.env.local.')
  }
  return { factory: getAddress(env.VITE_FACTORY_ADDRESS), deployBlock: BigInt(env.VITE_FACTORY_DEPLOY_BLOCK) }
}

// cacheTime 0: the specs read balances right after a transaction.
export const arc = createPublicClient({ chain: NET.chain, transport: http(NET.rpcUrl), cacheTime: 0 })

// The RPC must answer with the testnet chain id before anything is sent.
export async function checkChain() {
  const id = await arc.getChainId()
  if (id !== NET.chain.id) throw new Error(`${NET.rpcUrl} answered chain ${id}, expected Arc testnet ${NET.chain.id}`)
}

// The funder key lives only in app/.env.testnet.funder (gitignored) and only in this Node process. It is never
// printed, and no error message here includes it.
function funderKey(): Hex {
  const path = `${APP_DIR}${FUNDER_FILE}`
  if (!existsSync(path)) throw new Error(`Missing app/${FUNDER_FILE}. See e2e/README.md.`)
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('FUNDER_PRIVATE_KEY=')) continue
    const value = line.slice('FUNDER_PRIVATE_KEY='.length).trim().replace(/^["']|["']$/g, '')
    const key = value.startsWith('0x') ? value : `0x${value}`
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`FUNDER_PRIVATE_KEY in app/${FUNDER_FILE} is not a 32-byte hex key.`)
    return key as Hex
  }
  throw new Error(`app/${FUNDER_FILE} has no FUNDER_PRIVATE_KEY line.`)
}

export const PASSKEY_PATH = `${APP_DIR}${PASSKEY_FILE}`

// The shared e2e account's passkey, from app/.env.testnet.passkey (gitignored). Never printed.
export function loadSharedPasskey(): SharedPasskey {
  if (!existsSync(PASSKEY_PATH)) {
    throw new Error(`Missing app/${PASSKEY_FILE}. Make the shared account once with npm run e2e:make-account. See e2e/README.md.`)
  }
  return parseSharedPasskey(readFileSync(PASSKEY_PATH, 'utf8'))
}

let funderWallet: ReturnType<typeof makeFunder> | null = null
function makeFunder() {
  return createWalletClient({ chain: NET.chain, transport: http(NET.rpcUrl), account: privateKeyToAccount(funderKey()) })
}
function funderClient() {
  funderWallet ??= makeFunder()
  return funderWallet
}

export function funderAddress(): Address {
  return funderClient().account.address
}

// USDC through the ERC-20 interface (6 decimals). On Arc this is the native balance, which pays gas.
export function usdcBalance(owner: Address): Promise<bigint> {
  return arc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}

// An ERC-20 USDC transfer from the funder, waited for. Returns the transaction hash.
export async function fundFromFunder(to: Address, amount: bigint): Promise<Hex> {
  await checkChain()
  const wallet = funderClient()
  const hash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount] })
  const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new Error(`Funder transfer reverted: ${txUrl(hash)}`)
  return hash
}

export function txUrl(hash: Hex): string {
  return `${NET.explorerUrl}/tx/${hash}`
}

// Prints the explorer link in the run output and keeps it on the test as an annotation.
export function logTx(label: string, hash: Hex) {
  const url = txUrl(hash)
  console.log(`[tx] ${label}: ${url}`)
  test.info().annotations.push({ type: 'tx', description: `${label}: ${url}` })
}
