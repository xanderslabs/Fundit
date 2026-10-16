import { type Address, type EIP1193Provider, formatUnits, getAddress, type Hex, isHex, parseUnits } from 'viem'
import { CCTP_CHAINS, GATEWAY_URL } from '../config'
import { adapterFor } from './bridge'
import { isUserRejection, PlainError } from './errors'

// Gateway chains we read and spend from: Arc and the six CCTP chains. The kit checks the signer on each
// source chain through the adapter, and only these chains have an RPC the CSP allows.
const CHAINS = ['Arc', ...CCTP_CHAINS.map((c) => c.key)] as const
type UnifiedChain = (typeof CHAINS)[number]

export type ChainAmount = { chain: string; amount: bigint }
// Circle's fee per source chain, in 6-decimal units. Gateway checks amount plus fee against each chain's balance.
export type Reserves = ReadonlyMap<string, bigint>

// The kit is large, so it loads only when someone opens the unified balance option. One context serves
// every call. The telemetry flags are passed defensively: in 1.8.0 the functional API ignores them and sends
// no telemetry, and the CSP would block Circle's log endpoint anyway.
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

// The kit returns decimal strings such as "12.345678". Anything else fails loudly rather than show a wrong amount.
function toUnits(text: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error(`Circle returned an amount we could not read: ${text.slice(0, 40)}`)
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

// Fallback when Circle's estimate cannot be had. Source: the kit's own static table (GAS_FEE_BY_CHAIN and
// FORWARDER_SERVICE_FEE in @circle-fin/unified-balance-kit 1.8.0, from developers.circle.com/gateway/references/fees).
// Per chain: that chain's gas fee, plus the forwarder fee (0.2 service plus 0.001 Arc gas) on every chain,
// plus the 0.5 bps transfer fee on the chain's whole balance. Deliberately on the high side.
const STATIC_GAS: Record<UnifiedChain, string> = {
  Arc: '0.001',
  Ethereum: '2',
  Avalanche: '0.02',
  Optimism: '0.0015',
  Arbitrum: '0.01',
  Base: '0.01',
  Polygon: '0.0015',
}
const STATIC_FORWARDER = parseUnits('0.201', 6)
const DEFAULT_GAS = parseUnits('0.1', 6)

export function staticReserve(chain: string, available: bigint): bigint {
  const gas = chain in STATIC_GAS ? parseUnits(STATIC_GAS[chain as UnifiedChain], 6) : DEFAULT_GAS
  const transferFee = (available * 5n + 99_999n) / 100_000n
  return gas + STATIC_FORWARDER + transferFee
}

export function staticReserves(byChain: readonly ChainAmount[]): Map<string, bigint> {
  return new Map(byChain.map((c) => [c.chain, staticReserve(c.chain, c.amount)]))
}

const capped = (c: ChainAmount, reserves?: Reserves) => {
  const left = c.amount - (reserves?.get(c.chain) ?? 0n)
  return left > 0n ? left : 0n
}

// The most that can reach the campaign once each chain keeps back its fee.
export function maxSendable(byChain: readonly ChainAmount[], reserves: Reserves): bigint {
  return byChain.reduce((sum, c) => sum + capped(c, reserves), 0n)
}

// Which chains to draw the amount from: the largest first, so as few chains (and per-chain fees) as possible
// are used. Each chain gives at most its balance minus its fee reserve.
export function pickAllocations(byChain: readonly ChainAmount[], amount: bigint, reserves?: Reserves): ChainAmount[] {
  const usable = byChain.map((c) => ({ chain: c.chain, amount: capped(c, reserves) }))
  const sorted = usable.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
  const out: ChainAmount[] = []
  let remaining = amount
  for (const { chain, amount: available } of sorted) {
    if (remaining <= 0n) break
    if (available <= 0n) continue
    const take = available < remaining ? available : remaining
    out.push({ chain, amount: take })
    remaining -= take
  }
  if (remaining > 0n) throw new PlainError("Not enough unified balance to cover this amount and Circle's fees.")
  return out
}

type SpendTarget = { provider: EIP1193Provider; campaign: Address; account?: Address }

type Adapter = Awaited<ReturnType<typeof adapterFor>>['adapter']

function spendParams(adapter: Adapter, campaign: Address, allocations: readonly ChainAmount[]) {
  const total = allocations.reduce((s, a) => s + a.amount, 0n)
  return {
    token: 'USDC' as const,
    amount: formatUnits(total, 6),
    from: {
      adapter,
      allocations: allocations.map((a) => ({ chain: a.chain as UnifiedChain, amount: formatUnits(a.amount, 6) })),
    },
    to: { chain: 'Arc' as const, recipientAddress: getAddress(campaign), useForwarder: true },
  }
}

// Circle's fee per source chain for this exact allocation: the transfer and gas fees it lists per chain. The
// forwarder fee is listed as one flat amount; it is charged with one intent, so it is added to the largest
// allocation's chain. Reads only; nothing is signed.
export async function estimateChainFees(p: SpendTarget & { allocations: readonly ChainAmount[] }): Promise<Map<string, bigint>> {
  const [{ kit, ctx }, { adapter }] = await Promise.all([loadKit(), adapterFor(p.provider, p.account)])
  const est = await kit.estimateSpend(ctx, spendParams(adapter, p.campaign, p.allocations))
  const fees = new Map<string, bigint>()
  const add = (chain: string, v: bigint) => fees.set(chain, (fees.get(chain) ?? 0n) + v)
  for (const fee of est.fees) {
    if (fee.token !== 'USDC') throw new Error('Circle quoted a fee in a token other than USDC.')
    if (fee.allocations && fee.allocations.length > 0) {
      for (const a of fee.allocations) add(String(a.chain), toUnits(a.amount))
    } else if (p.allocations[0]) {
      add(p.allocations[0].chain, toUnits(fee.amount))
    }
  }
  return fees
}

const MAX_PASSES = 3

// Reserves fees before allocating: allocate, ask Circle for the fee on each chain used, cap each chain at
// its balance minus that fee, and repeat until every chain covers its share plus its fee (at most 3 passes).
// If Circle cannot be asked, the static reserve stands in. Throws before anything is signed when the
// balance cannot cover the amount and the fees.
export async function planSpend(
  p: SpendTarget & { byChain: readonly ChainAmount[]; amount: bigint; reserves?: Reserves },
): Promise<{ allocations: ChainAmount[]; reserves: Map<string, bigint> }> {
  const available = new Map(p.byChain.map((c) => [c.chain, c.amount]))
  const reserves = new Map(p.reserves ?? [])
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const allocations = pickAllocations(p.byChain, p.amount, reserves)
    let fees: Map<string, bigint>
    try {
      fees = await estimateChainFees({ ...p, allocations })
    } catch (err) {
      if (isUserRejection(err)) throw err
      fees = new Map(allocations.map((a) => [a.chain, staticReserve(a.chain, available.get(a.chain) ?? 0n)]))
    }
    for (const [chain, fee] of fees) if (fee > (reserves.get(chain) ?? 0n)) reserves.set(chain, fee)
    if (allocations.every((a) => a.amount + (fees.get(a.chain) ?? 0n) <= (available.get(a.chain) ?? 0n))) {
      return { allocations, reserves }
    }
  }
  throw new PlainError("Not enough unified balance to cover this amount and Circle's fees.")
}

// One estimate per chain with a balance, for the form's "Up to X" limit. A chain whose estimate fails keeps
// its static reserve. Reads only; nothing is signed.
export async function estimateReserves(p: SpendTarget & { byChain: readonly ChainAmount[] }): Promise<Map<string, bigint>> {
  const reserves = staticReserves(p.byChain)
  await Promise.all(
    p.byChain.map(async (c) => {
      const probe = capped(c, reserves)
      if (probe <= 0n) return
      try {
        const fees = await estimateChainFees({ ...p, allocations: [{ chain: c.chain, amount: probe }] })
        const fee = fees.get(c.chain)
        if (fee !== undefined) reserves.set(c.chain, fee)
      } catch {
        // Keep the static reserve for this chain.
      }
    }),
  )
  return reserves
}

const isTxHash = (v: unknown): v is Hex => typeof v === 'string' && isHex(v) && v.length === 66

// Thrown by donateFromUnified. signed is true once the wallet returned the burn intent signature: from then
// on Circle may have accepted the transfer, so the money may still move.
export class UnifiedSpendError extends Error {
  constructor(
    readonly signed: boolean,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'UnifiedSpendError'
    this.cause = cause
  }
}

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
  const [{ kit, ctx }, { adapter, watcher }] = await Promise.all([loadKit(), adapterFor(p.provider, p.account)])
  let signed = false
  watcher.onSign = () => {
    signed = true
  }
  let res: Awaited<ReturnType<typeof kit.spend>>
  try {
    res = await kit.spend(ctx, {
      token: 'USDC',
      amount: p.amount,
      from: { adapter, allocations: p.allocations.map((a) => ({ chain: a.chain as UnifiedChain, amount: a.amount })) },
      to: { chain: 'Arc', recipientAddress: getAddress(p.campaign), useForwarder: true },
    })
  } catch (err) {
    throw new UnifiedSpendError(signed, err)
  } finally {
    watcher.onSign = null
  }
  if (!isTxHash(res.txHash)) throw new UnifiedSpendError(true, new Error('Circle did not return the Arc transaction.'))
  return { txHash: res.txHash, ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}) }
}

function errorChain(err: unknown): { name?: unknown; message?: unknown; cause?: unknown }[] {
  const out: { name?: unknown; message?: unknown; cause?: unknown }[] = []
  let cur = err
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    out.push(cur as { name?: unknown; message?: unknown; cause?: unknown })
    cur = (cur as { cause?: unknown }).cause
  }
  return out
}

const TERMINAL_FORWARDER = /^(Forwarder transfer failed|Transfer attestation expired before forwarding completed)/

// True only when the money is known not to have moved, so the form can open again. That is any error
// before the wallet returned the signature (validation, an estimate failure, the donor cancelling),
// Gateway refusing the transfer for lack of balance, and the forwarder's terminal failed and expired states.
// Everything else may have been accepted by Circle and must stay blocked until it is checked.
export function isSafeToRetry(err: unknown): boolean {
  if (!(err instanceof UnifiedSpendError) || !err.signed) return true
  if (isUserRejection(err)) return true
  return errorChain(err).some(
    (x) =>
      x.name === 'BALANCE_INSUFFICIENT_TOKEN' ||
      x.name === 'BALANCE_INSUFFICIENT_GAS' ||
      (typeof x.message === 'string' && TERMINAL_FORWARDER.test(x.message)),
  )
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

// The transfer id from the kit's error when it stopped waiting for the forwarder, if it gave one.
export function pendingTransferId(err: unknown): string | null {
  for (const x of errorChain(err)) {
    const id = (x as { cause?: { trace?: { transferId?: unknown } } }).cause?.trace?.transferId
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}

// Plain text for the Gateway errors the general mapping does not word well. Null means use explainError.
export function explainUnifiedError(err: unknown): string | null {
  if (errorChain(err).some((x) => x.name === 'BALANCE_INSUFFICIENT_TOKEN' || x.name === 'BALANCE_INSUFFICIENT_GAS')) {
    return "Your unified balance does not cover this amount plus Circle's fees. Try a smaller amount."
  }
  if (errorChain(err).some((x) => typeof x.message === 'string' && TERMINAL_FORWARDER.test(x.message))) {
    return 'Circle could not finish this transfer. Check your unified balance, then try again.'
  }
  return null
}
