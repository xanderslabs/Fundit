import { describe, expect, it } from 'vitest'
import { blockTimeEstimate, perDay } from './trends'

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
