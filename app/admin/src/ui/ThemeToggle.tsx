import { resolveTheme, type ThemeChoice, useTheme } from '../../../src/lib/theme'
import { MoonIcon, SunIcon } from './icons'
import { Menu } from './Menu'

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// System, light or dark. The icon shows the theme in use.
export function ThemeToggle() {
  const { choice, setChoice } = useTheme()
  const dark = resolveTheme(choice, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) === 'dark'
  const current = CHOICES.find((c) => c.value === choice)!.label
  return (
    <Menu
      label={`Theme: ${current}`}
      className="admin-theme-toggle"
      trigger={dark ? <MoonIcon /> : <SunIcon />}
      items={CHOICES.map((c) => ({ label: c.label, current: c.value === choice, onSelect: () => setChoice(c.value) }))}
    />
  )
}
