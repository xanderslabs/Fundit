import { encodeFunctionData, parseAbi } from 'viem'
import { MULTICALL3_FROM } from '../config'
import type { Call } from './sender'

const multicall3FromAbi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
])

// Turns a call list into the one call a plain account (a wallet or an email account) sends as a single
// transaction. Arc's Multicall3From runs each inner call with the sender as msg.sender, so an approve and a
// donate act as that account. allowFailure is false, so one revert undoes them all. One call needs no wrapper.
export function toBatch(calls: Call[]): Call {
  const [first] = calls
  if (!first) throw new Error('No calls to batch')
  if (calls.length === 1) return first
  return {
    to: MULTICALL3_FROM,
    data: encodeFunctionData({
      abi: multicall3FromAbi,
      functionName: 'aggregate3',
      args: [calls.map((c) => ({ target: c.to, allowFailure: false, callData: c.data }))],
    }),
  }
}
