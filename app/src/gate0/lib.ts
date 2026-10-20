// Pure helpers for the Gate 0 page (gate0.html). Throwaway: the page is deleted after the run.
import { type Address, encodeAbiParameters, type Hex, keccak256, pad, parseAbi, parseAbiParameters } from 'viem'
import { CIRCLE_MULTISIG_MANIFEST_HASH, CIRCLE_MULTISIG_PLUGIN } from '../config'

// The weighted multisig plugin's owner functions, copied from the verified source of WeightedWebauthnMultisigPlugin
// at 0x0000000C984AFf541D6cE86Bb697e68ec57873C8 on explorer.testnet.arc.io (verified 2026-05-26, solc 0.8.24,
// src/msca/6900/v0.7/plugins/v1_0_0/multisig/WeightedWebauthnMultisigPlugin.sol). ownershipInfoOf returns a third
// value, OwnershipMetadata, as a struct.
export const pluginAbi = parseAbi([
  'struct PublicKey { uint256 x; uint256 y; }',
  'struct OwnerData { uint256 weight; uint8 credType; address addr; uint256 publicKeyX; uint256 publicKeyY; }',
  'struct OwnershipMetadata { uint256 numOwners; uint256 thresholdWeight; uint256 totalWeight; }',
  'function addOwners(address[] ownersToAdd, uint256[] weightsToAdd, PublicKey[] publicKeyOwnersToAdd, uint256[] pubicKeyWeightsToAdd, uint256 newThresholdWeight)',
  'function removeOwners(address[] ownersToRemove, PublicKey[] publicKeyOwnersToRemove, uint256 newThresholdWeight)',
  'function ownershipInfoOf(address account) view returns (bytes30[] ownerAddresses, OwnerData[] ownersData, OwnershipMetadata ownershipMetadata)',
  'error EmptyOwnersNotAllowed()',
  'error InvalidOwner(bytes30 owner)',
  'error OwnerDoesNotExist(bytes30 owner)',
  'error InvalidThresholdWeight()',
  'error ThresholdWeightExceedsTotalWeight(uint256 thresholdWeight, uint256 totalWeight)',
  'error ZeroOwnersInputNotAllowed()',
])

// enum CredentialType { PUBLIC_KEY, ADDRESS } in src/common/CommonStructs.sol of the same verified source.
export const CRED_TYPES = ['PUBLIC_KEY', 'ADDRESS'] as const

export type FactoryOwner = { kind: 'eoa'; address: Address } | { kind: 'passkey'; x: bigint; y: bigint }

// The arguments Circle's factory takes for an account with this owner alone, at weight 1 and threshold 1: the same
// sender, zero salt and initializing data the SDK passes to createAccount (getFactoryArgs in dist/index.mjs). The
// factory's getAddress with these gives the account's address on Arc.
export function factoryArgs(owner: FactoryOwner): readonly [Hex, Hex, Hex] {
  const sender =
    owner.kind === 'eoa' ? pad(owner.address.toLowerCase() as Hex) : keccak256(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [owner.x, owner.y]))
  const install = encodeAbiParameters(
    parseAbiParameters('address[], uint256[], (uint256 x, uint256 y)[], uint256[], uint256'),
    owner.kind === 'eoa' ? [[owner.address], [1n], [], [], 1n] : [[], [], [{ x: owner.x, y: owner.y }], [1n], 1n],
  )
  const init = encodeAbiParameters(parseAbiParameters('address[], bytes32[], bytes[]'), [[CIRCLE_MULTISIG_PLUGIN], [CIRCLE_MULTISIG_MANIFEST_HASH], [install]])
  return [sender, pad('0x', { size: 32 }), init]
}

// A 64-byte public key, or 65 bytes with the 0x04 prefix, as x and y.
export function publicKeyXY(publicKey: Hex): { x: bigint; y: bigint } {
  const hex = publicKey.slice(2)
  const body = hex.length === 130 ? hex.slice(2) : hex
  if (body.length !== 128) throw new Error(`Unreadable public key of ${body.length / 2} bytes`)
  return { x: BigInt(`0x${body.slice(0, 64)}`), y: BigInt(`0x${body.slice(64)}`) }
}

// Keys whose values never reach the page or the copied results.
const SECRET_KEY = /token|secret|private|mnemonic|seed|phrase|password|otp|jwt|^session|sessionid|cookie|authorization/i
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

// a***@example.com. The full address is never shown or copied.
export function maskEmails(text: string): string {
  return text.replace(EMAIL, '$1***@$2')
}

// A JSON-safe copy: bigints as strings, secrets redacted, emails masked, cycles cut, depth limited.
export function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return JWT.test(value) ? '[redacted jwt]' : maskEmails(value)
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Error) return serializeError(value, depth, seen)
  if (seen.has(value)) return '[cycle]'
  if (depth > 8) return '[depth]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1, seen)
  return out
}

// Every field of an error, with the cause chain in full: name, code, message, then viem's and the RPC's own fields
// (shortMessage, details, data, status, metaMessages) and any other own property.
export function serializeError(err: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (!(err instanceof Error)) return sanitize(err, depth, seen)
  if (seen.has(err)) return '[cycle]'
  seen.add(err)
  const out: Record<string, unknown> = { name: err.name }
  const x = err as Error & Record<string, unknown>
  for (const key of ['code', 'message', 'shortMessage', 'details', 'data', 'status', 'metaMessages', 'version']) {
    if (x[key] !== undefined) out[key] = sanitize(x[key], depth + 1, seen)
  }
  for (const key of Object.getOwnPropertyNames(err)) {
    if (key in out || key === 'stack' || key === 'cause') continue
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(x[key], depth + 1, seen)
  }
  if (err.stack) out.stack = maskEmails(err.stack.split('\n').slice(0, 6).join('\n'))
  if (err.cause !== undefined) out.cause = depth > 12 ? '[depth]' : serializeError(err.cause, depth + 1, seen)
  return out
}

export function toJson(value: unknown): string {
  return JSON.stringify(sanitize(value), null, 2)
}

// The key paths in obj whose string value looks like an email, for the "email field path" in G3.
export function emailPaths(obj: unknown, path = '', seen = new WeakSet<object>()): string[] {
  if (typeof obj === 'string') return /@[^@\s]+\.[a-z]{2,}$/i.test(obj) ? [path] : []
  if (obj === null || typeof obj !== 'object' || seen.has(obj)) return []
  seen.add(obj)
  return Object.entries(obj).flatMap(([k, v]) => emailPaths(v, path ? `${path}.${k}` : k, seen))
}

// USDC (6 decimals) an account must hold before the page sends: each user operation's prefund at Circle's fee now
// (gas limits times the max fee, with a 30% margin), rounded up to 0.1 USDC. The gas units are the app's measured
// stand-ins (FALLBACK_GAS_NEW_ACCOUNT for the first, deploying operation, FALLBACK_GAS_DEPLOYED for each next one).
export function usdcNeeded(maxFeePerGas: bigint, deployed: boolean, ops: number, gas: { newAccount: bigint; deployed: bigint }): bigint {
  const units = (deployed ? 0n : gas.newAccount - gas.deployed) + BigInt(ops) * gas.deployed
  const wei = (units * maxFeePerGas * 13n) / 10n
  const usdc = (wei + 10n ** 12n - 1n) / 10n ** 12n
  const tenth = 100_000n
  return ((usdc + tenth - 1n) / tenth) * tenth
}
