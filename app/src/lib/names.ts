import { type Address, type PublicClient, toCoinType } from 'viem'
import { base } from 'viem/chains'
import { normalize } from 'viem/ens'
import { safeHttpsUrl } from './urls'

export type NameClient = Pick<PublicClient, 'getEnsName' | 'getEnsAvatar'>

export type ResolvedName = { name: string | null; avatar: string | null; source: 'ens' | 'basename' | null }

const NONE: ResolvedName = { name: null, avatar: null, source: null }

async function tryName(lookup: () => Promise<string | null>): Promise<string | null> {
  try {
    return await lookup()
  } catch {
    return null
  }
}

// Reads the primary ENS name, then the primary Basename, from Ethereum mainnet. A lookup that fails counts as
// no name, so a broken resolver or gateway only means the short address is shown.
export async function resolveName(l1: NameClient, address: Address): Promise<ResolvedName> {
  const ens = await tryName(() => l1.getEnsName({ address }))
  const basename = ens ? null : await tryName(() => l1.getEnsName({ address, coinType: toCoinType(base.id) }))
  const name = ens ?? basename
  if (!name) return NONE
  let avatar: string | null = null
  try {
    const url = await l1.getEnsAvatar({ name: normalize(name) })
    avatar = url ? safeHttpsUrl(url) : null
  } catch {
    // No avatar, or one we cannot read. The name still shows.
  }
  return { name, avatar, source: ens ? 'ens' : 'basename' }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
