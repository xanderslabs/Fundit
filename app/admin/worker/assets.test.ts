// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loginFiles, type ManifestChunk } from './assets'

describe('loginFiles', () => {
  // Only the login page's own files are public. A chunk only the panel uses must stay behind the session.
  it('loginFiles follows imports, css and assets of login.html only', () => {
    const manifest: Record<string, ManifestChunk> = {
      'login.html': { file: 'assets/login-a1.js', css: ['assets/login-a1.css'], imports: ['_shared-b2.js'] },
      '_shared-b2.js': { file: 'assets/shared-b2.js', imports: ['_deep-c3.js'], assets: ['assets/logo-d4.svg'] },
      '_deep-c3.js': { file: 'assets/deep-c3.js', imports: ['_shared-b2.js'] },
      'index.html': { file: 'assets/index-e5.js', css: ['assets/index-e5.css'], imports: ['_shared-b2.js', '_panel-f6.js'] },
      '_panel-f6.js': { file: 'assets/panel-f6.js' },
    }
    expect([...loginFiles(manifest)].sort()).toEqual(
      ['/assets/deep-c3.js', '/assets/login-a1.css', '/assets/login-a1.js', '/assets/logo-d4.svg', '/assets/shared-b2.js', '/login.html'].sort(),
    )
  })

  it('loginFiles follows dynamicImports of login.html', () => {
    const manifest: Record<string, ManifestChunk> = {
      'login.html': { file: 'assets/login-a1.js', dynamicImports: ['_qr-g7.js'] },
      '_qr-g7.js': { file: 'assets/qr-g7.js', css: ['assets/qr-g7.css'], imports: ['_qrdep-h8.js'], dynamicImports: ['_lazy-i9.js'] },
      '_qrdep-h8.js': { file: 'assets/qrdep-h8.js' },
      '_lazy-i9.js': { file: 'assets/lazy-i9.js' },
      'index.html': { file: 'assets/index-e5.js', imports: ['_panel-f6.js'], dynamicImports: ['_panel-dyn-j1.js'] },
      '_panel-f6.js': { file: 'assets/panel-f6.js' },
      '_panel-dyn-j1.js': { file: 'assets/panel-dyn-j1.js' },
    }
    const files = loginFiles(manifest)
    for (const f of ['/assets/qr-g7.js', '/assets/qr-g7.css', '/assets/qrdep-h8.js', '/assets/lazy-i9.js']) expect(files.has(f)).toBe(true)
    for (const f of ['/assets/index-e5.js', '/assets/panel-f6.js', '/assets/panel-dyn-j1.js']) expect(files.has(f)).toBe(false)
  })

  it('is just the page when the manifest has no login entry', () => {
    expect([...loginFiles({})]).toEqual(['/login.html'])
  })
})
