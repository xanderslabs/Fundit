import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { factoryQueryOptions, snapshotQueryOptions } from './queries'

// Tests run from app/, as tokens.test.ts reads its file.
const SRC = 'admin/src/'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name)
    if (d.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path] : []
  })
}

// Every observer of one query key must share its options: each observer runs its own refetch timer, so a second
// setup for the snapshot would read every Fundit twice a minute and make the retry count depend on who fetched.
describe('snapshot query', () => {
  it('refreshes once a minute, only while the tab is visible, and retries once', () => {
    const o = snapshotQueryOptions('testnet', true)
    expect(o.queryKey).toEqual(['admin', 'testnet', 'snapshot'])
    expect(o.refetchInterval).toBe(60_000)
    expect(o.refetchIntervalInBackground).toBe(false)
    expect(o.retry).toBe(1)
    expect(o.enabled).toBe(true)
  })

  it('is set up only in lib/queries.ts', () => {
    const others = sourceFiles(SRC).filter((f) => !f.endsWith(join('lib', 'queries.ts')) && /'snapshot'\s*\]/.test(readFileSync(f, 'utf8')))
    expect(others.map((f) => f.slice(SRC.length))).toEqual([])
  })
})

describe('factory query', () => {
  it('refreshes once a minute, only while the tab is visible, and retries once', () => {
    const o = factoryQueryOptions('mainnet', true)
    expect(o.queryKey).toEqual(['admin', 'mainnet', 'factory'])
    expect(o.refetchInterval).toBe(60_000)
    expect(o.refetchIntervalInBackground).toBe(false)
    expect(o.retry).toBe(1)
  })

  it('is set up only in lib/queries.ts', () => {
    const others = sourceFiles(SRC).filter(
      (f) => !f.endsWith(join('lib', 'queries.ts')) && (/'factory'\s*\]/.test(readFileSync(f, 'utf8')) || /(?<!function )readFactoryState\(/.test(readFileSync(f, 'utf8'))),
    )
    expect(others.map((f) => f.slice(SRC.length))).toEqual([])
  })
})
