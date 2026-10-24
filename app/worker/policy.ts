// Which transactions the Worker lets Circle sign for an email account. The person still approves each one in
// Circle's window; this limits what a compromised page could ask for to Fundit's own contracts.
import { type Address, decodeFunctionData, type Hex, parseAbi } from 'viem'
import { MULTICALL3_FROM } from './networks'

export type PolicyContext = {
  chainId: number
  // USDC, EURC, the factory, TokenMessengerV2 and Multicall3From for the Worker's network. Any letter case.
  fixedTargets: ReadonlySet<string>
  // factory.isCampaign(address) through the network's RPC. Rejects when it cannot be read.
  isCampaign(address: Address): Promise<boolean>
}

export type PolicyResult = { ok: true } | { ok: false; reason: string }

const multicall3FromAbi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
])

// A plain EIP-1559 call, as the app builds it. Anything else (an EIP-7702 authorization list, an access list, a
// type) is refused rather than passed to Circle unchecked.
const ALLOWED_KEYS = new Set(['chainId', 'nonce', 'to', 'value', 'data', 'gas', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas'])
const NUMERIC_KEYS = ['nonce', 'gas', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/
const DECIMAL = /^(?:0|[1-9]\d{0,77})$/
// More calls than any Fundit action makes. Bounds the isCampaign reads per request.
const MAX_INNER_CALLS = 32

// A JSON number that is a safe non-negative integer, or the same as a decimal string.
function isUint(v: unknown): boolean {
  return (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && DECIMAL.test(v))
}

function refuse(reason: string): PolicyResult {
  return { ok: false, reason }
}

export async function checkSignRequest(tx: unknown, ctx: PolicyContext): Promise<PolicyResult> {
  if (typeof tx !== 'object' || tx === null || Array.isArray(tx)) return refuse('Transaction is not an object')
  const t = tx as Record<string, unknown>

  const extra = Object.keys(t).find((k) => !ALLOWED_KEYS.has(k))
  if (extra) return refuse(`Field not allowed: ${extra.slice(0, 40)}`)
  if (!isUint(t.chainId) || String(t.chainId) !== String(ctx.chainId)) return refuse('Wrong network')
  if (t.value !== undefined && t.value !== 0 && t.value !== '0') return refuse('Native value not allowed')
  for (const k of NUMERIC_KEYS) {
    if (t[k] !== undefined && !isUint(t[k])) return refuse(`Bad ${k}`)
  }
  if (t.data !== undefined && (typeof t.data !== 'string' || !HEX.test(t.data))) return refuse('Bad data')
  if (typeof t.to !== 'string' || !ADDRESS.test(t.to)) return refuse('Missing or bad to')

  const fixed = new Set([...ctx.fixedTargets].map((a) => a.toLowerCase()))
  const multicall = MULTICALL3_FROM.toLowerCase()
  const to = t.to.toLowerCase()

  let targets: string[]
  if (to === multicall) {
    // Every inner call runs as the account, so each target needs the same check as a direct call.
    if (typeof t.data !== 'string') return refuse('Multicall3From call has no data')
    let calls: readonly { target: Address }[]
    try {
      const decoded = decodeFunctionData({ abi: multicall3FromAbi, data: t.data as Hex })
      calls = decoded.args[0]
    } catch {
      return refuse('Multicall3From call is not aggregate3')
    }
    if (calls.length === 0 || calls.length > MAX_INNER_CALLS) return refuse('Wrong number of calls')
    targets = calls.map((c) => c.target.toLowerCase())
    // A nested Multicall3From would hide its own targets from this one-level check.
    if (targets.includes(multicall)) return refuse('Multicall3From inside Multicall3From')
  } else {
    targets = [to]
  }

  const unknown = [...new Set(targets.filter((a) => !fixed.has(a)))]
  try {
    const known = await Promise.all(unknown.map((a) => ctx.isCampaign(a as Address)))
    if (known.some((k) => k !== true)) return refuse('Contract not allowed')
  } catch {
    // Fail closed: a target that cannot be checked is not allowed.
    return refuse('Could not check the contract')
  }
  return { ok: true }
}
