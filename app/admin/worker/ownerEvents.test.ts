// @vitest-environment node
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from '../../src/abi/factory'
import { adminChain } from './chain'
import { fetchOwnerEvents, ownerEventText, OWNER_EVENTS, type OwnerEvent } from './ownerEvents'

const chain = adminChain('testnet')!
const A: Address = '0x1111111111111111111111111111111111111111'
const B: Address = '0x2222222222222222222222222222222222222222'
const HASH: Hex = `0x${'ab'.repeat(32)}`

function log(name: string, args: Record<string, unknown>, nonIndexed: [string[], unknown[]] | null, block: number, index: number) {
  const topics = encodeEventTopics({ abi: factoryAbi, eventName: name as never, args: args as never })
  const data = nonIndexed ? encodeAbiParameters(nonIndexed[0].map((type) => ({ type })), nonIndexed[1]) : '0x'
  return { address: chain.factory, topics, data, blockNumber: `0x${block.toString(16)}`, transactionHash: HASH, logIndex: `0x${index.toString(16)}`, removed: false }
}

const fees = (d: number, w: number, block = 10, idx = 0) => log('FeesUpdated', {}, [['uint16', 'uint16'], [d, w]], block, idx)

function rpc(logs: unknown[]): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    expect(body.method).toBe('eth_getLogs')
    return Response.json({ jsonrpc: '2.0', id: 1, result: logs })
  }) as unknown as typeof fetch
}

const ev = (name: OwnerEvent['name'], args: Record<string, unknown>): OwnerEvent => ({ name, args, blockNumber: 10n, txHash: HASH, logIndex: 0 })
const link = ` https://explorer.testnet.arc.io/tx/${HASH}`

describe('owner events', () => {
  it('announces each owner event with its explorer link', async () => {
    const events = await fetchOwnerEvents(chain.rpcUrl, chain.factory, 1n, 20n, rpc([fees(100, 50)]))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'FeesUpdated', blockNumber: 10n, txHash: HASH, logIndex: 0 })
    expect(ownerEventText(events[0]!, chain)).toBe(`[Arc Testnet] Fees changed to 100 bps on gifts and 50 bps on withdrawals.${link}`)
    const t = (e: OwnerEvent) => ownerEventText(e, chain)
    expect(t(ev('TreasuryUpdated', { treasury: A }))).toBe(`[Arc Testnet] Treasury changed to ${A}.${link}`)
    expect(t(ev('FeaturedUpdated', { campaign: A }))).toBe(`[Arc Testnet] Featured Fundit changed to ${A}.${link}`)
    expect(t(ev('FeaturedUpdated', { campaign: '0x0000000000000000000000000000000000000000' }))).toBe(`[Arc Testnet] Featured Fundit cleared.${link}`)
    expect(t(ev('CreationPausedSet', { paused: true }))).toBe(`[Arc Testnet] New Fundits paused.${link}`)
    expect(t(ev('CreationPausedSet', { paused: false }))).toBe(`[Arc Testnet] New Fundits allowed again.${link}`)
    expect(t(ev('OwnershipTransferStarted', { previousOwner: A, newOwner: B }))).toBe(`[Arc Testnet] Ownership transfer started to ${B}.${link}`)
    expect(t(ev('OwnershipTransferred', { previousOwner: A, newOwner: B }))).toBe(`[Arc Testnet] Ownership moved from ${A} to ${B}.${link}`)
    expect(OWNER_EVENTS).toHaveLength(6)
  })

  it('decodes every owner event kind from raw logs, oldest first', async () => {
    const logs = [
      log('OwnershipTransferred', { previousOwner: A, newOwner: B }, null, 12, 1),
      log('FeaturedUpdated', { campaign: A }, null, 11, 3),
      log('CreationPausedSet', {}, [['bool'], [true]], 11, 2),
      log('TreasuryUpdated', { treasury: B }, null, 10, 0),
    ]
    const events = await fetchOwnerEvents(chain.rpcUrl, chain.factory, 1n, 20n, rpc(logs))
    expect(events.map((e) => e.name)).toEqual(['TreasuryUpdated', 'CreationPausedSet', 'FeaturedUpdated', 'OwnershipTransferred'])
  })

  // The chat can be a group. Only what is already public on chain goes out.
  it('messages hold only public addresses, values and links', () => {
    const text = ownerEventText(ev('OwnershipTransferred', { previousOwner: A, newOwner: B }), chain)
    const stripped = text.replace(/^\[Arc Testnet\] /, '').replace(A, '').replace(B, '').replace(link, '')
    expect(stripped).toBe('Ownership moved from  to .')
    expect(text).not.toMatch(/https?:\/\/(?!explorer\.testnet\.arc\.io\/tx\/)/)
  })
})
