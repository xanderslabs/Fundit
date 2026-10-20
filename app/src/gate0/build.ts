// Build switch for the Gate 0 page. No import.meta.env here: vite.config.ts runs this at build time.
// Only VITE_GATE0=1 adds the gate0.html input and appends gate0.headers to dist/_headers, so a normal build of any
// branch never ships the page or its loose CSP.
export function gate0Enabled(env: { VITE_GATE0?: string }): boolean {
  return env.VITE_GATE0 === '1'
}

// dist/_headers with the Gate 0 rules after the site's own.
export function withGate0Headers(headers: string, gate0Headers: string): string {
  return `${headers.replace(/\n*$/, '\n')}\n${gate0Headers}`
}
