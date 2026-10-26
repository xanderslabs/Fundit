import { useEffect, useState } from 'react'

// The admin's colour theme. "system" follows the device setting; light and dark override it. The choice lives in
// this browser only. The resolved theme goes on <html> as data-theme, which turns on the dark tokens.
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'fundit-admin:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
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
  document.documentElement.dataset.theme = resolveTheme(choice, prefersDark())
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
