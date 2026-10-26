import { useEffect, useState } from 'react'
import type { ScanStatus } from '../lib/historyScan'
import { useScan } from '../scan/ScanProvider'

// Ticks every second while a countdown is shown.
export function useClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

// Seconds until the scan tries again, or 0 when it is not waiting.
export function useResumeSeconds(status: ScanStatus): number {
  const counting = status.resumeAt !== undefined
  const now = useClock(counting)
  return counting ? Math.max(0, Math.ceil((status.resumeAt! - now) / 1000)) : 0
}

// What a stopped scan says: a rate-limit wait or an error with its retry. null while it reads or once caught up.
export function waitLine(status: ScanStatus, seconds: number): string | null {
  if (status.kind === 'waiting') return `The RPC asked us to slow down. Resuming in ${seconds} s.`
  if (status.kind === 'error')
    return `Couldn't read the history (${status.message}).${status.resumeAt !== undefined ? ` Trying again in ${seconds} s.` : ''}`
  return null
}

// The label on every figure from the history scan until it has caught up, with the reason when the scan is stopped
// on a rate limit or an error. Nothing once caught up.
export function ScanNote() {
  const { status, progress } = useScan()
  const seconds = useResumeSeconds(status)
  if (status.kind === 'caughtUp') return null
  const wait = waitLine(status, seconds)
  return (
    <>
      <p className="admin-partial">Partial: read up to block {progress.readTo.toString()}</p>
      {wait && <p className={status.kind === 'error' ? 'admin-partial admin-scan-error' : 'admin-partial'}>{wait}</p>}
    </>
  )
}
