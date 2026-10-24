import type { Page } from '@playwright/test'
import { type Address, createWalletClient, encodeFunctionData, erc20Abi, type Hex, http, numberToHex, type PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { NET, USDC } from './arc'

// A test wallet for the browser: an EIP-1193 provider that the page announces through EIP-6963 as "Fundit Test
// Wallet". The page side only forwards requests. The key lives in this Node process (a fresh one per run, never
// printed) and signs here. Transactions go out through Arc testnet's public RPC.

export const WALLET_NAME = 'Fundit Test Wallet'
const BRIDGE = '__funditTestWalletRequest'
// Starts on Ethereum, so the app's switch to Arc (and the add-network request) is part of every run.
const START_CHAIN = 1

type Reply = { result: unknown } | { error: { code: number; message: string } }

export type TestWallet = {
  address: Address
  // Hashes of the transactions this wallet sent, with what each one was addressed to.
  sent: { hash: Hex; to: Address | undefined; data: Hex | undefined; value: bigint | undefined }[]
  // Methods the page asked for, in order.
  requests: string[]
  // Sends the whole USDC balance less the gas of that transfer to `to`. Returns the hash, or null when nothing is worth sending.
  returnTo(to: Address): Promise<Hex | null>
}

export async function installTestWallet(page: Page, arc: PublicClient): Promise<TestWallet> {
  const account = privateKeyToAccount(generatePrivateKey())
  const client = createWalletClient({ account, chain: NET.chain, transport: http(NET.rpcUrl) })
  const wallet: TestWallet = {
    address: account.address,
    sent: [],
    requests: [],
    async returnTo(to) {
      const held = await arc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, held] })
      const [gas, fees] = await Promise.all([arc.estimateGas({ account: account.address, to: USDC, data }), arc.estimateFeesPerGas()])
      // Gas is paid in the native 18-decimal USDC. Round up to the ERC-20's 6 decimals and keep a margin.
      const fee = ((gas * (fees.maxFeePerGas ?? 0n) * 2n) / 10n ** 12n) + 1n
      if (held <= fee) return null
      const hash = await client.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [to, held - fee] })
      const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 120_000 })
      if (receipt.status !== 'success') throw new Error(`Return transfer reverted: ${hash}`)
      return hash
    },
  }
  let chainId = START_CHAIN
  let arcAdded = false

  const fail = (code: number, message: string): Reply => ({ error: { code, message } })

  async function handle(method: string, params: unknown[]): Promise<Reply> {
    wallet.requests.push(method)
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return { result: [account.address] }
      case 'eth_chainId':
        return { result: numberToHex(chainId) }
      case 'net_version':
        return { result: String(chainId) }
      case 'wallet_addEthereumChain': {
        const wanted = Number((params[0] as { chainId: string }).chainId)
        if (wanted !== NET.chain.id) return fail(-32602, `This test wallet adds only Arc testnet, not ${wanted}`)
        arcAdded = true
        // Like MetaMask, adding a network also switches to it.
        chainId = wanted
        await emit(page, 'chainChanged', numberToHex(chainId))
        return { result: null }
      }
      case 'wallet_switchEthereumChain': {
        const wanted = Number((params[0] as { chainId: string }).chainId)
        if (wanted === START_CHAIN || (wanted === NET.chain.id && arcAdded)) {
          const changed = wanted !== chainId
          chainId = wanted
          if (changed) await emit(page, 'chainChanged', numberToHex(chainId))
          return { result: null }
        }
        return fail(4902, 'Unrecognized chain ID. Try adding the chain first.')
      }
      case 'eth_sendTransaction': {
        if (chainId !== NET.chain.id) return fail(4901, 'The test wallet is not on Arc testnet')
        const tx = params[0] as { to?: Address; data?: Hex; value?: Hex; from?: Address }
        if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) return fail(4100, 'Unknown account')
        const value = tx.value ? BigInt(tx.value) : undefined
        const hash = await client.sendTransaction({ to: tx.to, data: tx.data, value })
        wallet.sent.push({ hash, to: tx.to, data: tx.data, value })
        return { result: hash }
      }
      case 'personal_sign':
      case 'eth_sign':
      case 'eth_signTypedData_v4':
        return fail(4200, `The test wallet does not sign messages (${method})`)
      default:
        // Reads go to Arc's public RPC.
        if (chainId !== NET.chain.id) return fail(4200, `The test wallet is on chain ${chainId} and does not answer ${method}`)
        return { result: await arc.request({ method, params } as never) }
    }
  }

  await page.exposeFunction(BRIDGE, async (method: string, params: unknown[]): Promise<Reply> => {
    try {
      return await handle(method, params ?? [])
    } catch (err) {
      return fail(-32603, err instanceof Error ? err.message.split('\n')[0]! : 'The test wallet failed')
    }
  })

  await page.addInitScript(
    ([bridge, name]) => {
      type Listener = (...args: unknown[]) => void
      const listeners = new Map<string, Set<Listener>>()
      const provider = {
        async request({ method, params }: { method: string; params?: unknown[] }) {
          const reply = await (window as never as Record<string, (m: string, p: unknown[]) => Promise<{ result?: unknown; error?: { code: number; message: string } }>>)[bridge!]!(method, params ?? [])
          if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code })
          return reply.result
        },
        on(event: string, fn: Listener) {
          if (!listeners.has(event)) listeners.set(event, new Set())
          listeners.get(event)!.add(fn)
          return provider
        },
        removeListener(event: string, fn: Listener) {
          listeners.get(event)?.delete(fn)
          return provider
        },
      }
      ;(window as never as Record<string, unknown>).__funditTestWalletEmit = (event: string, data: unknown) => {
        for (const fn of listeners.get(event) ?? []) fn(data)
      }
      const icon =
        'data:image/svg+xml;base64,' +
        btoa('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="10" fill="#0b5fff"/></svg>')
      const detail = Object.freeze({ info: Object.freeze({ uuid: crypto.randomUUID(), name: name!, icon, rdns: 'fun.fundit.test-wallet' }), provider })
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
      window.addEventListener('eip6963:requestProvider', announce)
      announce()
    },
    [BRIDGE, WALLET_NAME],
  )
  return wallet
}

function emit(page: Page, event: string, data: unknown) {
  return page.evaluate(([e, d]) => (window as never as Record<string, (e: string, d: unknown) => void>).__funditTestWalletEmit?.(e as string, d), [event, data] as const).catch(() => {})
}
