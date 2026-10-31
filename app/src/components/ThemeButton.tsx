import { resolveTheme, useTheme } from '../lib/theme'
import './ThemeButton.css'

// Light or dark, beside the account pill. Until it is pressed the site follows the device setting; a press
// stores the other theme in this browser. The icon shows the theme in use.
export function ThemeButton() {
  const { choice, setChoice } = useTheme()
  const dark = resolveTheme(choice, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) === 'dark'
  return (
    <button type="button" className="theme-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setChoice(dark ? 'light' : 'dark')}>
      <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {dark ? (
          <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  )
}
