import { type Address, isAddressEqual, namehash, type PublicClient } from 'viem'
import { normalize } from 'viem/ens'
import { BASENAME_RESOLVER, basenameAbi, L2_REVERSE_REGISTRAR } from '../config'
import { safeHttpsUrl } from './urls'

export type NameClients = {
  l1: Pick<PublicClient, 'getEnsName' | 'getEnsText'>
  base: Pick<PublicClient, 'readContract'>
}

export type ResolvedName = { name: string | null; avatar: string | null; source: 'ens' | 'basename' | null }

const NONE: ResolvedName = { name: null, avatar: null, source: null }

async function orNull<T>(lookup: () => Promise<T>): Promise<T | null> {
  try {
    return await lookup()
  } catch {
    return null
  }
}

// The raw avatar text record, used only when it is a plain https URL. ipfs, ar, NFT and data records show
// no avatar: nothing is fetched or probed here, and the only request is the img tag in Name.
function avatarUrl(record: string | null): string | null {
  return record ? safeHttpsUrl(record) : null
}

// The primary Basename, read on Base. A reverse record can name anything, so the name only counts when
// the Basename resolves back to this address.
async function basename(base: NameClients['base'], address: Address): Promise<ResolvedName> {
  const name = await base.readContract({
    address: L2_REVERSE_REGISTRAR,
    abi: basenameAbi,
    functionName: 'nameForAddr',
    args: [address],
  })
  if (!name) return NONE
  const node = namehash(normalize(name))
  const owner = await base.readContract({ address: BASENAME_RESOLVER, abi: basenameAbi, functionName: 'addr', args: [node] })
  if (!isAddressEqual(owner, address)) return NONE
  const record = await orNull(() =>
    base.readContract({ address: BASENAME_RESOLVER, abi: basenameAbi, functionName: 'text', args: [node, 'avatar'] }),
  )
  return { name, avatar: avatarUrl(record), source: 'basename' }
}

// The primary ENS name from Ethereum mainnet, else the primary Basename from Base. A lookup that fails
// counts as no name, so a broken resolver only means the short address is shown.
export async function resolveName(clients: NameClients, address: Address): Promise<ResolvedName> {
  const ens = await orNull(() => clients.l1.getEnsName({ address }))
  if (ens) {
    const record = await orNull(() => clients.l1.getEnsText({ name: normalize(ens), key: 'avatar' }))
    return { name: ens, avatar: avatarUrl(record), source: 'ens' }
  }
  return (await orNull(() => basename(clients.base, address))) ?? NONE
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
