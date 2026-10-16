import { describe, expect, it } from 'vitest'
import { type BlockClient, blockTimes } from './useActivity'

describe('blockTimes', () => {
  // A timestamp is a nicety. One failed getBlock must not hide the whole activity list.
  it('leaves out blocks whose getBlock fails, so the list shows "Block N" for them', async () => {
    const client: BlockClient = {
      async getBlock({ blockNumber }) {
        if (blockNumber === 20n) throw new Error('rpc error')
        return { number: blockNumber, timestamp: blockNumber * 100n }
      },
    }
    const times = await blockTimes(client, [10n, 20n, 30n])
    expect(times.get(10n)).toBe(1000n)
    expect(times.has(20n)).toBe(false)
    expect(times.get(30n)).toBe(3000n)
  })
})
