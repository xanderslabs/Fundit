// The part of Cloudflare D1 the admin Worker uses. D1 satisfies it, and testing/sqliteDb.ts gives the same over
// node:sqlite for tests.

export interface DbStatement {
  bind(...values: unknown[]): DbStatement
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
  all<T>(): Promise<{ results: T[] }>
}

export interface Db {
  prepare(sql: string): DbStatement
}
