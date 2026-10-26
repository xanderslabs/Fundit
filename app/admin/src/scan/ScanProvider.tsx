import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { matchesWorker, type AdminSession } from '../lib/api'
import { scanClient } from '../lib/clients'
import { initialScanState, runScan, type ScanFundit, type ScanState, type ScanStatus } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { clear, load, save } from '../lib/scanStore'
import { useSnapshot } from '../lib/queries'

export type ScanContextValue = {
  state: ScanState | null
  status: ScanStatus
  progress: { readTo: bigint; head: bigint }
  canSave: boolean
  rescan(): void
  // Reads new blocks now instead of at the next poll, when the scan is caught up (after a confirmed change).
  nudge(): void
}

const ScanContext = createContext<ScanContextValue | null>(null)

export function useScan(): ScanContextValue {
  const scan = useContext(ScanContext)
  if (!scan) throw new Error('useScan needs a ScanProvider')
  return scan
}

// The one history scan for the selected network. It starts once the snapshot has the Fundit list, keeps running
// while the owner moves between pages, and stops when the network changes (give this a key per network) or the
// panel unmounts on sign-out or tab close. What it reads is saved in this browser only, after every step.
export function ScanProvider({ session, network, children }: { session: AdminSession; network: AdminNetwork; children: ReactNode }) {
  const { factory } = ADMIN_NETWORKS[network]
  const matches = matchesWorker(session, network)
  // The same snapshot read as the pages.
  const snapshot = useSnapshot(session, network)
  const fundits = useRef<ScanFundit[]>([])
  fundits.current = (snapshot.data ?? []).map((r) => ({ address: r.address, createdAtBlock: r.createdAtBlock }))
  const ready = matches && snapshot.data !== undefined

  const [state, setState] = useState<ScanState | null>(null)
  const [status, setStatus] = useState<ScanStatus>({ kind: 'scanning' })
  const [head, setHead] = useState(0n)
  const [canSave, setCanSave] = useState(true)
  // Bumped by rescan to start the loop again from an empty state.
  const [run, setRun] = useState(0)
  const loop = useRef<AbortController | null>(null)
  // Ends the scan's current wait early. Set only while the scan waits between polls once caught up, so a nudge never
  // cuts short a rate-limit wait.
  const wake = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    loop.current = controller
    const start = load(network, factory) ?? initialScanState(network)
    let saved: ScanState = start
    // The last status, so the wait after it knows whether the scan is caught up.
    let kind: ScanStatus['kind'] = 'scanning'
    setState(start)
    setStatus({ kind: 'scanning' })
    void runScan({
      client: scanClient(network),
      state: start,
      fundits: () => fundits.current,
      signal: controller.signal,
      onStep(next, h) {
        setHead(h)
        if (next === saved) return
        saved = next
        setState(next)
        // Kept in memory when the browser refuses to save.
        setCanSave(save(next))
      },
      onStatus(next) {
        kind = next.kind
        setStatus(next)
      },
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          const done = () => {
            clearTimeout(t)
            signal.removeEventListener('abort', done)
            if (wake.current === done) wake.current = null
            resolve()
          }
          const t = setTimeout(done, ms)
          signal.addEventListener('abort', done)
          if (kind === 'caughtUp') wake.current = done
        }),
    })
    return () => controller.abort()
  }, [ready, network, factory, run])

  function rescan() {
    // Stopped first, so a step already in flight cannot save after the clear.
    loop.current?.abort()
    clear(network, factory)
    setState(null)
    setHead(0n)
    setRun((n) => n + 1)
  }

  function nudge() {
    wake.current?.()
  }

  // Without the Fundit list the scan cannot start; say so instead of looking busy.
  const shown: ScanStatus = !ready && snapshot.isError ? { kind: 'error', message: "couldn't read the Fundit list" } : status

  const value: ScanContextValue = {
    state,
    status: shown,
    progress: { readTo: state?.scannedTo ?? 0n, head },
    canSave,
    rescan,
    nudge,
  }
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>
}
