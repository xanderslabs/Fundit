import { decodeFunctionData, getAddress, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { MULTICALL3_FROM } from '../config'
import { toBatch } from './batch'
import type { Call } from './sender'

const A: Call = { to: '0x00000000000000000000000000000000000000a1', data: '0x1234' }
const B: Call = { to: '0x00000000000000000000000000000000000000b2', data: '0xabcdef' }

describe('toBatch', () => {
  it('one call stays as it is', () => {
    expect(toBatch([A])).toEqual(A)
  })

  it('several calls become one aggregate3 call to Multicall3From', () => {
    const batch = toBatch([A, B])
    expect(batch.to).toBe(MULTICALL3_FROM)
    const decoded = decodeFunctionData({
      abi: parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])']),
      data: batch.data,
    })
    expect(decoded.functionName).toBe('aggregate3')
    expect(decoded.args[0]).toEqual([
      { target: getAddress(A.to), allowFailure: false, callData: A.data },
      { target: getAddress(B.to), allowFailure: false, callData: B.data },
    ])
  })

  it('refuses an empty list', () => {
    expect(() => toBatch([])).toThrow()
  })
})
