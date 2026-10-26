import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { matchesWorker, type AdminSession } from '../lib/api'
import { readClient, scanClient } from '../lib/clients'
import { initialScanState, runScan, type ScanFundit, type ScanState, type ScanStatus } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { clear, load, save } from '../lib/scanStore'
import { fetchSnapshot } from '../lib/snapshot'

export type ScanContextValue = {
  state: ScanState | null
  status: ScanStatus
  progress: { readTo: bigint; head: bigint }
  canSave: boolean
  rescan(): void
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
  // Same key as the pages, so they share one read.
  const snapshot = useQuery({
    queryKey: ['admin', network, 'snapshot'],
    queryFn: () => fetchSnapshot(readClient(network), network),
    enabled: matches,
    refetchInterval: 60_000,
  })
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

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    loop.current = controller
    const start = load(network, factory) ?? initialScanState(network)
    let saved: ScanState = start
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
      onStatus: setStatus,
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

  // Without the Fundit list the scan cannot start; say so instead of looking busy.
  const shown: ScanStatus = !ready && snapshot.isError ? { kind: 'error', message: "couldn't read the Fundit list" } : status

  const value: ScanContextValue = {
    state,
    status: shown,
    progress: { readTo: state?.scannedTo ?? 0n, head },
    canSave,
    rescan,
  }
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>
}
