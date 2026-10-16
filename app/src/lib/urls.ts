const MAX_URL_LENGTH = 500

// Only plain https URLs may reach an href or src. Campaign links and images come from anyone.
export function safeHttpsUrl(u: string): string | null {
  if (u.length === 0 || u.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return null
  }
  return parsed.protocol === 'https:' ? u : null
}
