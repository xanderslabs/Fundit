import type { FunditSnapshot } from './snapshot'

const DAY = 86_400n

// How many of times (unix seconds) fall in each UTC day, oldest day first, ending with today. Times before the
// window or after now are left out.
export function perDay(times: bigint[], days: number, nowSec: bigint): number[] {
  const counts = new Array<number>(days).fill(0)
  const today = nowSec / DAY
  for (const t of times) {
    if (t > nowSec) continue
    const i = days - 1 - Number(today - t / DAY)
    if (i >= 0) counts[i]! += 1
  }
  return counts
}

export type Anchor = { block: bigint; time: bigint }

// A block's time estimated on the straight line through two blocks whose times are known. The anchors must be
// different blocks. Used where an event carries only its block number, so every time from it is an estimate.
export function blockTimeEstimate(a: Anchor, b: Anchor): (block: bigint) => bigint {
  return (block) => a.time + ((block - a.block) * (b.time - a.time)) / (b.block - a.block)
}

// Block times estimated from the oldest Fundit, whose creation time is on chain, and a recent block read from the
// RPC (head). Without head (the read failed or has not answered yet), from the oldest and newest Fundit: two Fundits
// created close together give a poor slope, so head is preferred. null without two different anchor blocks.
export function blockClock(rows: FunditSnapshot[], head?: Anchor): ((block: bigint) => bigint) | null {
  if (rows.length === 0) return null
  const first = rows.reduce((m, r) => (r.createdAtBlock < m.createdAtBlock ? r : m))
  const older = { block: first.createdAtBlock, time: first.createdAt }
  if (head && head.block > older.block) return blockTimeEstimate(older, head)
  const last = rows.reduce((m, r) => (r.createdAtBlock > m.createdAtBlock ? r : m))
  if (first.createdAtBlock === last.createdAtBlock) return null
  return blockTimeEstimate(older, { block: last.createdAtBlock, time: last.createdAt })
}
