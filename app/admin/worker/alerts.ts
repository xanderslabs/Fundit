// Turns one run's check results into the messages to send and the rows to keep. Pure: the cron owns D1 and Telegram.
import type { Check } from './health'

// One failed run can be a blip, so the owner hears about a problem on the second run in a row.
export const FAILS_BEFORE_ALERT = 2
export const REMIND_EVERY_MS = 3_600_000

export type AlertRow = { key: string; failing: boolean; failCount: number; since: number; lastSent: number }

// 2026-10-25 12:05 UTC
function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function decideAlerts(prev: AlertRow[], checks: Check[], nowMs: number): { send: string[]; next: AlertRow[] } {
  const send: string[] = []
  const next: AlertRow[] = []
  for (const check of checks) {
    const row = prev.find((r) => r.key === check.key) ?? { key: check.key, failing: false, failCount: 0, since: 0, lastSent: 0 }
    if (check.ok) {
      if (row.failing) send.push(`${check.key} is back to normal.`)
      next.push({ key: check.key, failing: false, failCount: 0, since: 0, lastSent: 0 })
      continue
    }
    const failCount = row.failCount + 1
    if (!row.failing) {
      if (failCount >= FAILS_BEFORE_ALERT) {
        send.push(`${check.key} is failing: ${check.detail}`)
        next.push({ key: check.key, failing: true, failCount, since: nowMs, lastSent: nowMs })
      } else {
        next.push({ ...row, failCount })
      }
    } else if (nowMs - row.lastSent >= REMIND_EVERY_MS) {
      send.push(`${check.key} is still failing (since ${utc(row.since)}).`)
      next.push({ ...row, failCount, lastSent: nowMs })
    } else {
      next.push({ ...row, failCount })
    }
  }
  return { send, next }
}
