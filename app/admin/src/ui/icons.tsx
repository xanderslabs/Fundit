import type { ReactNode } from 'react'

// The admin's icons, drawn by hand in the style of src/components/ui/CloseIcon: a 24 unit grid shown at 20px,
// 1.75px round strokes in currentColor, hidden from screen readers (the control around each one names it).
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="admin-icon"
    >
      {children}
    </svg>
  )
}

// Four tiles, the larger one top left.
export function OverviewIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="7" height="9" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="15" width="7" height="5" rx="1.5" />
    </Icon>
  )
}

// A list of Fundits: rows with a bullet.
export function FunditsIcon() {
  return (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </Icon>
  )
}

// A wrapped gift.
export function GiftsIcon() {
  return (
    <Icon>
      <rect x="4" y="9" width="16" height="11" rx="1.5" />
      <path d="M3 9h18M12 9v11" />
      <path d="M12 9c-1.5-3-5-3.5-5-1.25C7 9 9.5 9 12 9Zm0 0c1.5-3 5-3.5 5-1.25C17 9 14.5 9 12 9Z" />
    </Icon>
  )
}

// A pulse line.
export function ActivityIcon() {
  return (
    <Icon>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </Icon>
  )
}

// A heart with a beat through it.
export function HealthIcon() {
  return (
    <Icon>
      <path d="M12 20s-7.5-4.6-7.5-10A4.25 4.25 0 0 1 12 7.4 4.25 4.25 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />
      <path d="M7.5 12.5h2.5l1.25-2 1.75 3.5 1.25-1.5h2.25" />
    </Icon>
  )
}

// Two sliders.
export function SettingsIcon() {
  return (
    <Icon>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  )
}

export function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </Icon>
  )
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-.25A1.75 1.75 0 0 0 13.75 3.5h-8.5A1.75 1.75 0 0 0 3.5 5.25v8.5c0 .97.78 1.75 1.75 1.75h.25" />
    </Icon>
  )
}

export function ExternalLinkIcon() {
  return (
    <Icon>
      <path d="M13 4.5h6.5V11M19.5 4.5 11 13" />
      <path d="M17 14v4.25c0 .97-.78 1.75-1.75 1.75h-9.5A1.75 1.75 0 0 1 4 18.25v-9.5C4 7.78 4.78 7 5.75 7H10" />
    </Icon>
  )
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Icon>
  )
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
    </Icon>
  )
}

export function ChevronDownIcon() {
  return (
    <Icon>
      <path d="m7 10 5 5 5-5" />
    </Icon>
  )
}
