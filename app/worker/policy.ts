// Which transactions the Worker lets Circle sign for an email account. The person still approves each one in
// Circle's window; this limits what a compromised page could ask for to the calls Fundit itself makes.
import { type Abi, type Address, decodeFunctionData, encodeFunctionData, type Hex, parseAbi } from 'viem'
import { MULTICALL3_FROM } from './networks'

export type PolicyContext = {
  chainId: number
  usdc: Address
  eurc: Address
  tokenMessengerV2: Address
  factory: Address
  // factory.isCampaign(address) through the network's RPC. Rejects when it cannot be read.
  isCampaign(address: Address): Promise<boolean>
}

export type PolicyResult = { ok: true } | { ok: false; reason: string }

// The fields of a plain EIP-1559 call, in the order canonicalTransaction writes them. Anything else (an EIP-7702
// authorization list, an access list, a type) is refused rather than passed to Circle unchecked.
const ALLOWED_KEYS = ['chainId', 'nonce', 'to', 'value', 'data', 'gas', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const
const NUMERIC_KEYS = ['nonce', 'gas', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const

const multicall3FromAbi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
])
// Only the token calls the app builds: transfer (Send out, Add money) and approve (donate.ts, accountWithdraw.ts).
const tokenAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function approve(address spender, uint256 amount) returns (bool)'])
// The one TokenMessengerV2 call the app makes (accountWithdraw.ts, Send out to another chain).
const messengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
])

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/
const DECIMAL = /^(?:0|[1-9]\d{0,77})$/
// More calls than any Fundit action makes. Bounds the isCampaign reads per request.
const MAX_INNER_CALLS = 32

class Refused extends Error {}

// A JSON number that is a safe non-negative integer (not -0), or the same as a decimal string.
function isUint(v: unknown): boolean {
  return (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0)) || (typeof v === 'string' && DECIMAL.test(v))
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

// Decodes calldata against a small ABI and re-encodes it, so trailing or odd bytes cannot pass a check that the
// contract would read differently.
function decodeExact(abi: Abi, data: Hex): { functionName: string; args: readonly unknown[] } | null {
  let decoded: { functionName: string; args?: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi, data })
  } catch {
    return null
  }
  const args = decoded.args ?? []
  const again = encodeFunctionData({ abi, functionName: decoded.functionName, args } as Parameters<typeof encodeFunctionData>[0])
  return same(again, data) ? { functionName: decoded.functionName, args } : null
}

// Checks one call (the transaction itself or one inner aggregate3 call) by target and function.
async function checkCall(target: string, data: Hex | undefined, ctx: PolicyContext, campaign: (a: string) => Promise<boolean>, inner: boolean): Promise<void> {
  if (same(target, MULTICALL3_FROM)) {
    // A nested Multicall3From would hide its own targets from this check.
    if (inner) throw new Refused('Multicall3From inside Multicall3From')
    const call = data && decodeExact(multicall3FromAbi, data)
    if (!call) throw new Refused('Multicall3From call is not aggregate3')
    const calls = call.args[0] as readonly { target: Address; callData: Hex }[]
    if (calls.length === 0 || calls.length > MAX_INNER_CALLS) throw new Refused('Wrong number of calls')
    // Every inner call runs as the account, so each one gets the same check as a direct call.
    await Promise.all(calls.map((c) => checkCall(c.target, c.callData, ctx, campaign, true)))
    return
  }
  if (same(target, ctx.usdc) || same(target, ctx.eurc)) {
    const call = data && decodeExact(tokenAbi, data)
    if (!call) throw new Refused('Token call not allowed')
    if (call.functionName === 'transfer') return
    // approve: only to a Fundit campaign (a gift), or USDC to TokenMessengerV2 (Send out to another chain).
    const spender = call.args[0] as Address
    if (same(target, ctx.usdc) && same(spender, ctx.tokenMessengerV2)) return
    if (await campaign(spender)) return
    throw new Refused('Approval not allowed')
  }
  if (same(target, ctx.tokenMessengerV2)) {
    const call = data && decodeExact(messengerAbi, data)
    if (!call || !same(call.args[3] as Address, ctx.usdc)) throw new Refused('TokenMessengerV2 call not allowed')
    return
  }
  // The factory and Fundit campaigns are Fundit's own contracts: any function, owner-only ones revert on chain.
  if (same(target, ctx.factory)) return
  if (await campaign(target)) return
  throw new Refused('Contract not allowed')
}

export async function checkSignRequest(tx: unknown, ctx: PolicyContext): Promise<PolicyResult> {
  if (typeof tx !== 'object' || tx === null || Array.isArray(tx)) return { ok: false, reason: 'Transaction is not an object' }
  const t = tx as Record<string, unknown>
  const allowed: readonly string[] = ALLOWED_KEYS
  const extra = Object.keys(t).find((k) => !allowed.includes(k))
  if (extra) return { ok: false, reason: `Field not allowed: ${extra.slice(0, 40)}` }
  if (!isUint(t.chainId) || String(t.chainId) !== String(ctx.chainId)) return { ok: false, reason: 'Wrong network' }
  if (t.value !== undefined && !(t.value === '0' || (t.value === 0 && !Object.is(t.value, -0)))) return { ok: false, reason: 'Native value not allowed' }
  for (const k of NUMERIC_KEYS) {
    if (t[k] !== undefined && !isUint(t[k])) return { ok: false, reason: `Bad ${k}` }
  }
  if (t.data !== undefined && (typeof t.data !== 'string' || !HEX.test(t.data))) return { ok: false, reason: 'Bad data' }
  if (typeof t.to !== 'string' || !ADDRESS.test(t.to)) return { ok: false, reason: 'Missing or bad to' }

  // One isCampaign read per address per request.
  const seen = new Map<string, Promise<boolean>>()
  const campaign = (a: string): Promise<boolean> => {
    const key = a.toLowerCase()
    let p = seen.get(key)
    if (!p) {
      p = ctx.isCampaign(key as Address).then((v) => v === true)
      seen.set(key, p)
    }
    return p
  }
  try {
    await checkCall(t.to, t.data as Hex | undefined, ctx, campaign, false)
  } catch (e) {
    // Fail closed: a target that cannot be checked is not allowed.
    return { ok: false, reason: e instanceof Refused ? e.message : 'Could not check the contract' }
  }
  return { ok: true }
}

// The transaction Circle signs: only the allowed fields of the checked object, as plain JSON. Sending this rather
// than the client's string means Circle signs exactly what the policy read (no duplicate keys or odd numbers).
export function canonicalTransaction(tx: Record<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const k of ALLOWED_KEYS) if (tx[k] !== undefined) out[k] = tx[k]
  return JSON.stringify(out)
}
