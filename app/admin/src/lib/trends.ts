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

type Anchor = { block: bigint; time: bigint }

// A block's time estimated on the straight line through two blocks whose times are known. The anchors must be
// different blocks. Used where an event carries only its block number, so every time from it is an estimate.
export function blockTimeEstimate(a: Anchor, b: Anchor): (block: bigint) => bigint {
  return (block) => a.time + ((block - a.block) * (b.time - a.time)) / (b.block - a.block)
}
