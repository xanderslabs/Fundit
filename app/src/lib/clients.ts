import { createPublicClient, http } from 'viem'
import { arc, base, mainnet } from 'viem/chains'
import { ARC_RPC_URL, CCTP_CHAINS, MAINNET_RPC_URL } from '../config'

// Read-only Arc client for campaign reads. Writes go through the wallet, not this client.
export const arcClient = createPublicClient({ chain: arc, transport: http(ARC_RPC_URL) })

// Ethereum mainnet, only for ENS names and Basenames. A page full of cards asks for many names at once,
// so the calls go out as JSON-RPC batches.
export const mainnetClient = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC_URL, { batch: true }) })

// Base, only for Basenames. Uses the same public Base RPC as the CCTP routes.
const BASE_RPC_URL = CCTP_CHAINS.find((c) => c.key === 'Base')!.rpcUrl
export const baseClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL, { batch: true }) })
