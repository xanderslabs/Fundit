import { createPublicClient, http } from 'viem'
import { arc } from 'viem/chains'
import { ARC_RPC_URL } from '../config'

// Read-only Arc client for campaign reads. Writes go through the wallet, not this client.
export const arcClient = createPublicClient({ chain: arc, transport: http(ARC_RPC_URL) })
