import { type Address, type Chain, createPublicClient, type EIP1193Provider, getAddress, type Hex, http, isAddress, isHex, parseUnits, UserRejectedRequestError } from 'viem'
import { ARC_RPC_URL, CCTP_CHAINS, type CctpChain, type CctpChainKey } from '../config'

// One localStorage key holds everything that must survive a reload: cross-chain transfers on their way
// to Arc, and at most one unconfirmed Arc donation per campaign. Storage can throw (private windows,
// blocked site data), so every access is wrapped and a failure only loses the reminder, never money.
const KEY = 'fundit.pendingBridges'
// Fired on window after every change, so open trackers re-read the store.
export const PENDING_EVENT = 'fundit:pending'

export type PendingBridge = { kind: 'bridge'; campaign: Address; burnTx: Hex; srcDomain: number; amount: string; createdAt: number }
export type PendingArc = { kind: 'arc'; campaign: Address; hash: Hex; approve: boolean; createdAt: number }
type Entry = PendingBridge | PendingArc

const isTxHash = (v: unknown): v is Hex => typeof v === 'string' && isHex(v) && v.length === 66

function isEntry(e: unknown): e is Entry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  if (typeof x.campaign !== 'string' || !isAddress(x.campaign) || typeof x.createdAt !== 'number') return false
  if (x.kind === 'bridge') {
    return isTxHash(x.burnTx) && CCTP_CHAINS.some((c) => c.domain === x.srcDomain) && typeof x.amount === 'string'
  }
  if (x.kind === 'arc') return isTxHash(x.hash) && typeof x.approve === 'boolean'
  return false
}

function readAll(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

function writeAll(entries: Entry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Storage is unavailable. The transaction itself is unaffected.
  }
  window.dispatchEvent(new Event(PENDING_EVENT))
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function pendingBridges(): PendingBridge[] {
  return readAll().filter((e): e is PendingBridge => e.kind === 'bridge')
}

export function clearBridge(burnTx: Hex) {
  writeAll(readAll().filter((e) => !(e.kind === 'bridge' && same(e.burnTx, burnTx))))
}

function saveBridge(entry: Omit<PendingBridge, 'kind' | 'createdAt'>) {
  writeAll([...readAll(), { kind: 'bridge', ...entry, createdAt: Date.now() }])
}

export function pendingArc(campaign: Address): PendingArc | null {
  return readAll().find((e): e is PendingArc => e.kind === 'arc' && same(e.campaign, campaign)) ?? null
}

export function savePendingArc(p: { campaign: Address; hash: Hex; approve: boolean }) {
  const others = readAll().filter((e) => !(e.kind === 'arc' && same(e.campaign, p.campaign)))
  writeAll([...others, { kind: 'arc', ...p, createdAt: Date.now() }])
}

export function clearPendingArc(campaign: Address) {
  const all = readAll()
  const rest = all.filter((e) => !(e.kind === 'arc' && same(e.campaign, campaign)))
  if (rest.length !== all.length) writeAll(rest)
}

export function chainByKey(key: CctpChainKey): CctpChain {
  return CCTP_CHAINS.find((c) => c.key === key)!
}

export type CrossChainParams = { provider: EIP1193Provider; sourceKey: CctpChainKey; campaign: Address; amount: string; fast: boolean }

// The SDK is large, so it loads only when someone donates from another chain.
async function setup(p: CrossChainParams) {
  const chain = chainByKey(p.sourceKey)
  if (p.fast && !chain.fast) throw new Error(`Fast transfers are not available from ${chain.key}.`)
  const [{ BridgeKit }, { createViemAdapterFromProvider }] = await Promise.all([
    import('@circle-fin/bridge-kit'),
    import('@circle-fin/adapter-viem-v2'),
  ])
  // Error reporting off: the SDK would otherwise POST error details to Circle.
  const kit = new BridgeKit({ disableErrorReporting: true })
  const adapter = await createViemAdapterFromProvider({
    provider: p.provider,
    // Reads go through our own RPCs, which are the hosts the CSP allows, not the SDK's defaults.
    getPublicClient: ({ chain: c }: { chain: Chain }) => createPublicClient({ chain: c, transport: http(rpcFor(c.id)) }),
    capabilities: { addressContext: 'user-controlled' },
  })
  const params = {
    from: { adapter, chain: chain.key },
    // The forwarder mints straight to the campaign contract on Arc. No donate() call follows.
    to: { chain: 'Arc' as const, recipientAddress: getAddress(p.campaign), useForwarder: true as const },
    amount: p.amount,
    config: { transferSpeed: p.fast ? ('FAST' as const) : ('SLOW' as const) },
  }
  return { kit, params, chain }
}

function rpcFor(chainId: number): string | undefined {
  if (chainId === 5042) return ARC_RPC_URL
  return CCTP_CHAINS.find((c) => c.chainId === chainId)?.rpcUrl
}

// Total USDC the transfer costs out of the amount (CCTP fee plus forwarding fee), in 6-decimal units.
// Source-chain gas is separate and paid in that chain's native token.
export async function estimateCrossChain(p: CrossChainParams): Promise<bigint> {
  const { kit, params } = await setup(p)
  const est = await kit.estimate(params)
  let total = 0n
  for (const fee of est.fees) {
    if (fee.amount === null || fee.token !== 'USDC') throw new Error('Could not estimate the transfer fees.')
    total += parseUnits(fee.amount, 6)
  }
  return total
}

type Step = { name?: string; state?: string; txHash?: string; errorMessage?: string; errorCategory?: string; error?: unknown }

// A burn that may be on chain: mined, or its receipt wait timed out. A reverted burn moved nothing.
function burnMayBeOnChain(step: Step): step is Step & { txHash: string } {
  if (!isTxHash(step.txHash)) return false
  if (step.state === 'success') return true
  return step.state === 'error' && step.errorCategory !== 'reverted_onchain' && step.errorCategory !== 'chain_revert'
}

function stepError(step: Step | undefined): Error {
  if (step?.errorCategory === 'user_rejected') return new UserRejectedRequestError(new Error(step.errorMessage ?? 'User rejected'))
  const err = new Error(step?.errorMessage ?? 'The transfer did not start.')
  if (step?.error !== undefined) err.cause = step.error
  return err
}

// Burns USDC on the source chain and returns as soon as the burn has a hash. Circle's forwarder then
// mints it to the campaign on Arc; the tracker follows that through Iris, even after a reload.
export async function donateCrossChain(p: CrossChainParams): Promise<{ burnTx: Hex; srcDomain: number }> {
  const { kit, params, chain } = await setup(p)
  return new Promise((resolve, reject) => {
    let settled = false
    const onBurn = (payload: { values: Step }) => {
      const step = payload.values
      if (settled || !burnMayBeOnChain(step)) return
      settled = true
      kit.off('burn', onBurn)
      const burnTx = step.txHash as Hex
      saveBridge({ campaign: getAddress(p.campaign), burnTx, srcDomain: chain.domain, amount: p.amount })
      resolve({ burnTx, srcDomain: chain.domain })
    }
    kit.on('burn', onBurn)
    // bridge() keeps running after we resolve, until the mint. Its outcome then only matters if no burn was seen.
    kit.bridge(params).then(
      (result) => {
        if (settled) return
        const steps = (result?.steps ?? []) as Step[]
        // In case the burn event was missed, the result still lists the burn step.
        const burn = steps.find((s) => s.name === 'burn')
        if (burn) onBurn({ values: burn })
        if (settled) return
        settled = true
        kit.off('burn', onBurn)
        reject(stepError(steps.find((s) => s.state === 'error')))
      },
      (err: unknown) => {
        if (settled) return
        settled = true
        kit.off('burn', onBurn)
        reject(err)
      },
    )
  })
}
