// The owner's review states for Fundits (moderation/migrations). This Worker is the only writer. The note is kept
// here and never sent to the public Worker. Addresses are stored lowercase. Never log a note or a request body.
import type { WorkerNetwork } from '../../worker/networks'
import type { Db } from './db'

export type ModState = 'review' | 'removed' | 'cleared'

type StateRow = { address: string; state: ModState; note: string | null; updated_at: number }
type LogRow = { old_state: ModState | null; new_state: ModState; note: string | null; at: number }

export async function listStates(db: Db, network: WorkerNetwork): Promise<{ address: string; state: ModState; note: string; updatedAt: number }[]> {
  const { results } = await db
    .prepare('SELECT address, state, note, updated_at FROM fundit_state WHERE network = ? ORDER BY updated_at DESC, address')
    .bind(network)
    .all<StateRow>()
  return results.map((r) => ({ address: r.address, state: r.state, note: r.note ?? '', updatedAt: r.updated_at }))
}

// The log row is written first, reading the old state from the table, then the row is upserted.
export async function setState(db: Db, network: WorkerNetwork, address: string, state: ModState, note: string, nowMs: number): Promise<void> {
  const key = address.toLowerCase()
  await db
    .prepare(
      'INSERT INTO fundit_state_log (network, address, old_state, new_state, note, at) SELECT ?1, ?2, (SELECT state FROM fundit_state WHERE network = ?1 AND address = ?2), ?3, ?4, ?5',
    )
    .bind(network, key, state, note, nowMs)
    .run()
  await db
    .prepare(
      'INSERT INTO fundit_state (network, address, state, note, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (network, address) DO UPDATE SET state = excluded.state, note = excluded.note, updated_at = excluded.updated_at',
    )
    .bind(network, key, state, note, nowMs)
    .run()
}

export async function stateHistory(
  db: Db,
  network: WorkerNetwork,
  address: string,
): Promise<{ oldState: ModState | null; newState: ModState; note: string; at: number }[]> {
  const { results } = await db
    .prepare('SELECT old_state, new_state, note, at FROM fundit_state_log WHERE network = ? AND address = ? ORDER BY at DESC, id DESC')
    .bind(network, address.toLowerCase())
    .all<LogRow>()
  return results.map((r) => ({ oldState: r.old_state, newState: r.new_state, note: r.note ?? '', at: r.at }))
}
