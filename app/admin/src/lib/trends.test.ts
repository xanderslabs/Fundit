import { describe, expect, it } from 'vitest'
import type { FunditSnapshot } from './snapshot'
import { blockClock, blockTimeEstimate, perDay } from './trends'

const DAY = 86_400n
// 2026-10-26 15:00 UTC.
const NOW = 1_793_026_800n
const TODAY = (NOW / DAY) * DAY

describe('perDay', () => {
  it('counts each time in its UTC day, oldest day first, with zeros for empty days', () => {
    const times = [
      TODAY, // today, first second
      NOW, // today, now
      TODAY - 1n, // yesterday, last second
      TODAY - 2n * DAY, // two days ago
    ]
    expect(perDay(times, 4, NOW)).toEqual([0, 1, 1, 2])
  })

  it('leaves out times before the window and after now', () => {
    expect(perDay([TODAY - 3n * DAY, NOW + DAY], 3, NOW)).toEqual([0, 0, 0])
  })

  it('returns days zeros with no times', () => {
    expect(perDay([], 7, NOW)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('blockTimeEstimate', () => {
  const a = { block: 1_000n, time: 1_000_000n }
  const b = { block: 3_000n, time: 1_001_000n }

  it('maps both anchors exactly', () => {
    const at = blockTimeEstimate(a, b)
    expect(at(a.block)).toBe(a.time)
    expect(at(b.block)).toBe(b.time)
  })

  it('is linear between and beyond the anchors', () => {
    const at = blockTimeEstimate(a, b)
    expect(at(2_000n)).toBe(1_000_500n)
    expect(at(5_000n)).toBe(1_002_000n)
  })
})

describe('blockClock', () => {
  const fundit = (createdAtBlock: bigint, createdAt: bigint) => ({ createdAtBlock, createdAt }) as FunditSnapshot
  // Two Fundits ten blocks apart, whose times are whole seconds of a sub-second chain: the slope between them says
  // 3 s a block when the chain makes 1. Extended across 100,000 blocks, that puts a recent gift days in the future.
  const rows = [fundit(1_000n, 1_000_000n), fundit(1_010n, 1_000_030n)]
  const head = { block: 101_000n, time: 1_100_000n }

  it('anchors the newer end on the head block, so a recent block lands near the head time', () => {
    const clock = blockClock(rows, head)!
    const recent = clock(100_990n)
    expect(recent >= head.time - 60n && recent <= head.time).toBe(true)
    expect(clock(head.block)).toBe(head.time)
    expect(clock(1_000n)).toBe(1_000_000n)
  })

  it('works from one Fundit and the head block', () => {
    expect(blockClock([rows[0]!], head)!(head.block)).toBe(head.time)
  })

  it('falls back to the oldest and newest Fundit without a head block', () => {
    const clock = blockClock(rows)!
    expect(clock(1_000n)).toBe(1_000_000n)
    expect(clock(1_010n)).toBe(1_000_030n)
    expect(blockClock([rows[0]!])).toBeNull()
  })
})
