import { useEffect, useState } from 'react'

// The colour theme of fundit.fun and the admin panel. "system" follows the device setting; light and dark override
// it. The choice lives in this browser only. The resolved theme goes on <html> as data-theme, which turns on the
// dark tokens (styles/tokens.css). The embed page never applies it, so a Fundit on another site stays light.
export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'fundit:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
// The browser bar colour: --bg of each palette.
const BAR: Record<Theme, string> = { light: '#ffffff', dark: '#0c121c' }

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light'
  return choice
}

// Storage can be blocked (a private window) or throw; the theme then falls back to the system setting.
function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function storeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Not saved: the choice holds until the page closes.
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
}

function apply(choice: ThemeChoice) {
  const theme = resolveTheme(choice, prefersDark())
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme])
}

// The theme on the page now, for widgets drawn outside our CSS (Turnstile, Circle's window).
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

// Sets data-theme before the first render, so the page does not flash light (the CSP allows no inline script).
export function applyStoredTheme() {
  apply(readChoice())
}

export function useTheme(): { choice: ThemeChoice; setChoice(c: ThemeChoice): void } {
  const [choice, setState] = useState<ThemeChoice>(readChoice)

  useEffect(() => {
    apply(choice)
    if (choice !== 'system' || typeof matchMedia !== 'function') return
    const query = matchMedia(DARK_QUERY)
    const onChange = () => apply('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [choice])

  function setChoice(c: ThemeChoice) {
    storeChoice(c)
    setState(c)
  }

  return { choice, setChoice }
}
