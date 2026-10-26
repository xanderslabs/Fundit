// The panel's pages. The Worker sends the panel for these paths (with or without one trailing slash) only with a
// session, and the login page otherwise. The browser routes between them.
export const PANEL_PATHS = ['/', '/fundits', '/gifts', '/activity', '/health', '/settings'] as const

export type PanelPath = (typeof PANEL_PATHS)[number]

// Where the login page sends the owner after sign-in: the panel page they asked for, with its query (so
// ?network=testnet survives), or Overview for any other path.
export function afterSignIn(pathname: string, search: string): string {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return (PANEL_PATHS as readonly string[]).includes(path) ? `${path}${search}` : '/'
}
