import { type Address, type EIP1193Provider, getAddress, type Hex, isHex, parseUnits } from 'viem'
import { CCTP_CHAINS, GATEWAY_URL } from '../config'
import { adapterFor } from './bridge'
import { PlainError } from './errors'

// Gateway chains we read and spend from: Arc and the six CCTP chains. The kit checks the signer on each
// source chain through the adapter, and only these chains have an RPC the CSP allows.
const CHAINS = ['Arc', ...CCTP_CHAINS.map((c) => c.key)] as const
type UnifiedChain = (typeof CHAINS)[number]

export type ChainAmount = { chain: string; amount: bigint }

// The kit is large, so it loads only when someone opens the unified balance option. One context serves
// every call. Telemetry off: the SDK would otherwise send usage and error reports to Circle.
let loaded: Promise<{ kit: typeof import('@circle-fin/unified-balance-kit'); ctx: import('@circle-fin/unified-balance-kit').UnifiedBalanceKitContext }> | null = null

function loadKit() {
  if (!loaded) {
    const loading = import('@circle-fin/unified-balance-kit').then((kit) => ({
      kit,
      ctx: kit.createUnifiedBalanceKitContext({ disableAnalytics: true, disableErrorReporting: true }),
    }))
    loading.catch(() => {
      loaded = null
    })
    loaded = loading
  }
  return loaded
}

// The kit returns decimal strings such as "12.345678". Anything else fails loudly rather than show a wrong balance.
function toUnits(text: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error(`Circle returned a balance we could not read: ${text.slice(0, 40)}`)
  return parseUnits(text, 6)
}

// The confirmed Gateway USDC balance of this address, in total and per chain (chains with nothing are left out).
export async function fetchUnifiedBalance(address: Address): Promise<{ total: bigint; byChain: ChainAmount[] }> {
  const { kit, ctx } = await loadKit()
  const res = await kit.getBalances(ctx, { token: 'USDC', sources: { address, chains: [...CHAINS] } })
  const perChain = new Map<string, bigint>()
  for (const account of res.breakdown) {
    for (const b of account.breakdown) perChain.set(b.chain, (perChain.get(b.chain) ?? 0n) + toUnits(b.confirmedBalance))
  }
  const byChain = [...perChain].filter(([, amount]) => amount > 0n).map(([chain, amount]) => ({ chain, amount }))
  return { total: toUnits(res.totalConfirmedBalance), byChain }
}

// Which chains to draw the amount from: the largest balances first, so as few chains as possible are used.
export function pickAllocations(byChain: readonly ChainAmount[], amount: bigint): ChainAmount[] {
  const sorted = [...byChain].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
  const out: ChainAmount[] = []
  let remaining = amount
  for (const { chain, amount: available } of sorted) {
    if (remaining <= 0n) break
    if (available <= 0n) continue
    const take = available < remaining ? available : remaining
    out.push({ chain, amount: take })
    remaining -= take
  }
  if (remaining > 0n) throw new PlainError('Not enough unified balance.')
  return out
}

const isTxHash = (v: unknown): v is Hex => typeof v === 'string' && isHex(v) && v.length === 66

// The donor signs once. Circle then mints the USDC straight to the campaign contract on Arc through its
// forwarder, so no donate() call follows: the campaign counts it as a cross-chain donation. The kit resolves
// once the Arc mint is confirmed, with that transaction's hash.
export async function donateFromUnified(p: {
  provider: EIP1193Provider
  campaign: Address
  amount: string
  allocations: { chain: string; amount: string }[]
  account?: Address
}): Promise<{ txHash: Hex; explorerUrl?: string }> {
  const [{ kit, ctx }, adapter] = await Promise.all([loadKit(), adapterFor(p.provider, p.account)])
  const res = await kit.spend(ctx, {
    token: 'USDC',
    amount: p.amount,
    from: { adapter, allocations: p.allocations.map((a) => ({ chain: a.chain as UnifiedChain, amount: a.amount })) },
    to: { chain: 'Arc', recipientAddress: getAddress(p.campaign), useForwarder: true },
  })
  if (!isTxHash(res.txHash)) throw new Error('Circle did not return the Arc transaction.')
  return { txHash: res.txHash, ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}) }
}

export type GatewayTransfer = { status: 'done'; txHash: Hex } | { status: 'pending' } | { status: 'failed' }

// Where a forwarded transfer is, for when the kit stopped waiting before the mint. Read only.
export async function fetchGatewayTransfer(transferId: string): Promise<GatewayTransfer> {
  const res = await fetch(`${GATEWAY_URL}/v1/transfer/${encodeURIComponent(transferId)}`)
  if (!res.ok) throw new Error(`Circle did not answer (HTTP ${res.status}).`)
  const body = (await res.json()) as { status?: unknown; transactionHash?: unknown }
  if ((body.status === 'confirmed' || body.status === 'finalized') && isTxHash(body.transactionHash)) {
    return { status: 'done', txHash: body.transactionHash }
  }
  if (body.status === 'failed' || body.status === 'expired') return { status: 'failed' }
  return { status: 'pending' }
}

// The transfer id from the kit's error when it stopped waiting for the forwarder. The transfer was accepted
// by then, so the mint may still happen and the donation must not be offered again until it is checked.
export function pendingTransferId(err: unknown): string | null {
  let cur = err
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const id = (cur as { cause?: { trace?: { transferId?: unknown } } }).cause?.trace?.transferId
    if (typeof id === 'string' && id !== '') return id
    cur = (cur as { cause?: unknown }).cause
  }
  return null
}

// Plain text for the Gateway errors the general mapping does not word well. Null means use explainError.
export function explainUnifiedError(err: unknown): string | null {
  let cur = err
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const name = (cur as { name?: unknown }).name
    if (name === 'BALANCE_INSUFFICIENT_TOKEN' || name === 'BALANCE_INSUFFICIENT_GAS') {
      return "Your unified balance does not cover this amount plus Circle's fees. Try a smaller amount."
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return null
}
