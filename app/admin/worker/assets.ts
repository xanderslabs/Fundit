// Which built files are public. Vite's manifest lists each entry with its own files; only the login page's go
// out without a session.

export const MANIFEST_PATH = '/manifest.json'

// The font the login page's stylesheet loads. It comes from Vite's public dir, so the manifest does not list it.
export const LOGIN_FONT = '/fonts/Outfit-VariableFont_wght.ttf'

export type ManifestChunk = { file: string; css?: string[]; assets?: string[]; imports?: string[]; dynamicImports?: string[] }

// /login.html plus everything its entry loads, following imports and on-demand imports (the wallet code loads
// its QR and WalletConnect chunks that way) all the way down.
export function loginFiles(manifest: Record<string, ManifestChunk>): Set<string> {
  const files = new Set<string>(['/login.html'])
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = Object.hasOwn(manifest, key) ? manifest[key] : undefined
    if (!chunk) return
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      if (typeof file === 'string' && file) files.add(`/${file}`)
    }
    for (const next of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(next)
  }
  visit('login.html')
  return files
}
