// The 5 minute cron. In order: prune nonces, run the health checks, announce new owner events
// from a cursor kept in D1, then send the alerts (a failed event scan is one of the checks). The cursor moves only past events whose message was sent, so a Telegram outage
// delays an event and never drops it. Without the Telegram secrets the checks still run.
//
// Never log the token, the chat id or a message. The one log line is the fixed text `telegram not configured`.
import { decideAlerts, type AlertRow } from './alerts'
import { ADMIN_CHAINS, type AdminChain } from './chain'
import type { Db } from './db'
import { runChecks } from './health'
import type { Env } from './index'
import { pruneNonces } from './nonces'
import { CONFIRMATIONS, fetchOwnerEvents, MAX_EVENT_WINDOWS_PER_RUN, networkLabel, ownerEventText } from './ownerEvents'
import type { WorkerNetwork } from '../../worker/networks'
import { sendTelegram } from '../../worker/telegram'

// Blocks per eth_getLogs call.
const EVENT_WINDOW_BLOCKS = 10_000n

async function getMeta(db: Db, key: string): Promise<string | null> {
  return (await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null
}

async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run()
}

type Row = { key: string; failing: number; fail_count: number; since: number; last_sent: number }

async function readAlertRows(db: Db): Promise<AlertRow[]> {
  const { results } = await db.prepare('SELECT key, failing, fail_count, since, last_sent FROM alert_state').all<Row>()
  return results.map((r) => ({ key: r.key, failing: r.failing === 1, failCount: r.fail_count, since: r.since, lastSent: r.last_sent }))
}

async function writeAlertRows(db: Db, rows: AlertRow[]): Promise<void> {
  for (const r of rows) {
    await db
      .prepare(
        'INSERT INTO alert_state (key, failing, fail_count, since, last_sent) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET failing = excluded.failing, fail_count = excluded.fail_count, since = excluded.since, last_sent = excluded.last_sent',
      )
      .bind(r.key, r.failing ? 1 : 0, r.failCount, r.since, r.lastSent)
      .run()
  }
}

type Send = (text: string) => Promise<boolean>

// Returns false only when the scan itself could not read events. A Telegram failure is not a scan failure.
async function ownerEvents(db: Db, chain: AdminChain, head: bigint, send: Send, fetcher: typeof fetch): Promise<boolean> {
  const confirmed = head - CONFIRMATIONS
  const cursorKey = `owner_events_next:${chain.network}`
  const stored = await getMeta(db, cursorKey)
  if (stored === null) {
    // First run: no history is replayed. Block `confirmed` is the first one scanned.
    if (await send(`[${networkLabel(chain)}] Owner alerts started at block ${confirmed} on ${networkLabel(chain)}.`)) await setMeta(db, cursorKey, String(confirmed))
    return true
  }
  let from = BigInt(stored)
  for (let i = 0; i < MAX_EVENT_WINDOWS_PER_RUN && from <= confirmed; i++) {
    const to = from + EVENT_WINDOW_BLOCKS - 1n < confirmed ? from + EVENT_WINDOW_BLOCKS - 1n : confirmed
    let events
    try {
      events = await fetchOwnerEvents(chain.rpcUrl, chain.factory, from, to, fetcher)
    } catch {
      return false
    }
    let sent = 0
    for (const event of events) {
      if (!(await send(ownerEventText(event, chain)))) {
        // Earlier events in this window went out; resume at the failed event's block.
        if (sent > 0) await setMeta(db, cursorKey, String(event.blockNumber))
        return true
      }
      sent++
    }
    from = to + 1n
    await setMeta(db, cursorKey, String(from))
  }
  return true
}

// Alert text starts with the check key. Chain checks name their network, site and ucw belong to Fundit itself.
function labelFor(message: string): string {
  if (message.startsWith('rpc:arc-mainnet') || message.startsWith('events:arc-mainnet')) return 'Arc Mainnet'
  if (message.startsWith('rpc:arc-testnet') || message.startsWith('events:arc-testnet')) return 'Arc Testnet'
  return 'Fundit'
}

export async function runCron(env: Env, nowMs: number, fetcher: typeof fetch = (i, n) => fetch(i, n)): Promise<void> {
  const db = env.ADMIN_DB
  await pruneNonces(db, nowMs)
  const chains = Object.values(ADMIN_CHAINS)

  const lastTexts = {} as Record<WorkerNetwork, string | null>
  const lastHeads = {} as Record<WorkerNetwork, bigint | null>
  for (const c of chains) {
    lastTexts[c.network] = await getMeta(db, `rpc_head:${c.network}`)
    lastHeads[c.network] = lastTexts[c.network] === null ? null : BigInt(lastTexts[c.network] as string)
  }
  const { checks, heads } = await runChecks(chains, lastHeads, fetcher)
  for (const c of chains) {
    const head = heads[c.network]
    const last = lastHeads[c.network]
    if (head !== null && (last === null || head > last)) await setMeta(db, `rpc_head:${c.network}`, head.toString())
  }

  const configured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
  if (!configured) console.log('telegram not configured')
  const send: Send = (text) => sendTelegram(env.TELEGRAM_BOT_TOKEN as string, env.TELEGRAM_CHAT_ID as string, text, fetcher)

  // Each scan runs before decideAlerts so a failing scan is alerted in the same run. A scan is skipped without
  // Telegram or without a head, and one network's failure never stops the other's scan.
  if (configured) {
    for (const c of chains) {
      const head = heads[c.network]
      if (head === null) continue
      const ok = await ownerEvents(db, c, head, send, fetcher)
      checks.push({ key: `events:arc-${c.network}`, ok, detail: 'owner event scan failed' })
    }
  }

  const { send: messages, next } = decideAlerts(await readAlertRows(db), checks, nowMs)
  let allSent = true
  if (configured) {
    for (const m of messages) if (!(await send(`[${labelFor(m)}] ${m}`))) allSent = false
  }
  // If a send failed the rows stay as they were, so the same alert is decided again next run.
  if (allSent) await writeAlertRows(db, next)
}
