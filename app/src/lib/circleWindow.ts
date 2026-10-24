import { useSyncExternalStore } from 'react'

// Whether Circle's window (its code screen or a challenge) is open. Circle draws it in the page, under the browser's
// top layer, so an open Fundit dialog steps aside while it is up (ui/Dialog). Kept apart from circleEmail so the
// dialog never loads Circle's code.
let open = 0
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

// Marks Circle's window as open. Call the returned function once it closes for any reason; a second call does nothing.
export function openCircleWindow(): () => void {
  open++
  notify()
  let closed = false
  return () => {
    if (closed) return
    closed = true
    open--
    notify()
  }
}

export function isCircleWindowOpen(): boolean {
  return open > 0
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useCircleWindowOpen(): boolean {
  return useSyncExternalStore(subscribe, isCircleWindowOpen, isCircleWindowOpen)
}
