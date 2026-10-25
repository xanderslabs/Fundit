// An in-memory Db for tests, over Node's built-in SQLite. Not used by the Worker.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Db, DbStatement } from '../db'

export function sqliteDb(schemaSql: string): Db {
  const db = new DatabaseSync(':memory:')
  db.exec(schemaSql)
  const statement = (sql: string, values: SQLInputValue[]): DbStatement => ({
    bind: (...next: unknown[]) => statement(sql, next as SQLInputValue[]),
    first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
    run: async () => db.prepare(sql).run(...values),
    all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
  })
  return { prepare: (sql) => statement(sql, []) }
}
