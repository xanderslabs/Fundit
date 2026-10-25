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

  it('is just the page when the manifest has no login entry', () => {
    expect([...loginFiles({})]).toEqual(['/login.html'])
  })
})
