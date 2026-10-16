const MAX_URL_LENGTH = 500

// Only plain https URLs may reach an href or src. Campaign links and images come from anyone.
export function safeHttpsUrl(u: string): string | null {
  // The URL parser forgives "https:x", leading spaces and upper case, so also require the literal prefix.
  if (u.length > MAX_URL_LENGTH || !u.startsWith('https://')) return null
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return null
  }
  return parsed.protocol === 'https:' ? u : null
}
