import { TURNSTILE_SCRIPT_URL } from '../config'

export type Turnstile = {
  render(
    el: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void },
  ): string | null | undefined
  reset(widgetId?: string): void
  remove(widgetId?: string): void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let turnstileScript: Promise<Turnstile> | null = null

// Cloudflare's Turnstile script loads only when this form opens. A failed load is forgotten, so the next open tries again.
export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  turnstileScript ??= new Promise<Turnstile>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = TURNSTILE_SCRIPT_URL
    el.async = true
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
    el.onerror = () => {
      el.remove()
      turnstileScript = null
      reject(new Error('Turnstile did not load'))
    }
    document.head.append(el)
  })
  return turnstileScript
}
