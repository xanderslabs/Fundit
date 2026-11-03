import { type Address, createPublicClient, http } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey, NETWORK, TOKENS } from '../config'
import { arcClient } from './clients'

// Each network gets this long to answer. A slow or rate-limited public RPC fails only its own row.
export const CHAIN_TIMEOUT_MS = 8_000

export type ChainKey = 'Arc' | CctpChainKey

// One network to read the account's USDC on.
export type BalanceSource = { key: ChainKey; label: string; read: (account: Address) => Promise<bigint> }

// What one network said. A failed row has no amount at all, so it can never be shown or added up as 0.
export type ChainState = { status: 'pending' } | { status: 'failed' } | { status: 'ok'; amount: bigint }
export type ChainBalance = { key: ChainKey; label: string } & ChainState

export type ChainBalances = {
  rows: ChainBalance[]
  // The sum of the rows that answered. Rows that failed or are still loading are left out.
  total: bigint
  answered: number
  failed: number
  pending: number
}

export const chainBalanceKey = (key: ChainKey, account: Address) => ['chain-balance', NETWORK.name, key, account.toLowerCase()] as const

// One network's balance, or a rejection once timeoutMs passes with no answer.
export function readWithTimeout(source: BalanceSource, account: Address, timeoutMs = CHAIN_TIMEOUT_MS): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${source.label} did not answer within ${timeoutMs} ms`)), timeoutMs)
    source.read(account).then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Puts each network's state next to its name and adds up only the networks that answered.
export function summarize(sources: readonly BalanceSource[], states: readonly ChainState[]): ChainBalances {
  const rows = sources.map(({ key, label }, i): ChainBalance => ({ key, label, ...(states[i] ?? { status: 'pending' }) }))
  let total = 0n
  for (const row of rows) if (row.status === 'ok') total += row.amount
  const count = (s: ChainState['status']) => rows.filter((r) => r.status === s).length
  return { rows, total, answered: count('ok'), failed: count('failed'), pending: count('pending') }
}

// Arc, then each CCTP chain of this network, each read through its own public RPC (all listed in connect-src).
// The account is an EOA, so it has the same address on every chain.
export function usdcSources(): BalanceSource[] {
  const arc: BalanceSource = {
    key: 'Arc',
    label: CHAIN_LABELS.Arc,
    read: (account) => arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
  }
  const others = CCTP_CHAINS.map((c): BalanceSource => {
    // No retries: one try inside the timeout, so a down RPC fails fast instead of piling up requests.
    const client = createPublicClient({ chain: c.viemChain, transport: http(c.rpcUrl, { timeout: CHAIN_TIMEOUT_MS, retryCount: 0 }) })
    return {
      key: c.key,
      label: CHAIN_LABELS[c.key],
      read: (account) => client.readContract({ address: c.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    }
  })
  return [arc, ...others]
}
