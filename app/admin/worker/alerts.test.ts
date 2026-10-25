// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decideAlerts, REMIND_EVERY_MS, type AlertRow } from './alerts'

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0)
const bad = [{ key: 'site', ok: false, detail: 'status 500' }]
const good = [{ key: 'site', ok: true, detail: 'ok' }]

function run(prev: AlertRow[], checks: typeof bad, nowMs: number) {
  return decideAlerts(prev, checks, nowMs)
}

describe('decideAlerts', () => {
  // One blip (a slow RPC, a deploy) must not wake the owner.
  it('alerts after two failing runs in a row, not one', () => {
    const first = run([], bad, T0)
    expect(first.send).toEqual([])
    const second = run(first.next, bad, T0 + 300_000)
    expect(second.send).toEqual(['site is failing: status 500'])
    expect(second.next[0]).toMatchObject({ key: 'site', failing: true, since: T0 + 300_000, lastSent: T0 + 300_000 })
    // A pass between two failures resets the count.
    const reset = run(first.next, good, T0 + 300_000)
    expect(run(reset.next, bad, T0 + 600_000).send).toEqual([])
  })

  // A problem the owner has not fixed should not go quiet, and should not spam every 5 minutes either.
  it('reminds every hour while a problem lasts', () => {
    let rows = run(run([], bad, T0).next, bad, T0 + 300_000).next
    const since = T0 + 300_000
    const quiet = run(rows, bad, since + REMIND_EVERY_MS - 1)
    expect(quiet.send).toEqual([])
    rows = quiet.next
    const remind = run(rows, bad, since + REMIND_EVERY_MS)
    expect(remind.send).toEqual(['site is still failing (since 2026-10-25 12:05 UTC).'])
    expect(run(remind.next, bad, since + REMIND_EVERY_MS + 300_000).send).toEqual([])
  })

  it('sends one back to normal message', () => {
    const failing = run(run([], bad, T0).next, bad, T0 + 300_000).next
    const back = run(failing, good, T0 + 600_000)
    expect(back.send).toEqual(['site is back to normal.'])
    expect(back.next[0]).toMatchObject({ failing: false, failCount: 0 })
    expect(run(back.next, good, T0 + 900_000).send).toEqual([])
  })
})
