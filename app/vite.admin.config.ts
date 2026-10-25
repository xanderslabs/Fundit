import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ADMIN_CSP } from './admin/worker/headers.ts'
import { checkBuildEnv, loadConfig } from './src/deployConfig.ts'

// The admin panel (admin.fundit.fun) is its own build, apart from the public site: login.html is public, index.html
// is the panel. manifest.json lists which built files each page loads, so the Worker (admin/worker/assets.ts) serves
// only the login page's files without a session.
export default defineConfig(({ command, mode }) => {
  // Same checks as the public build: the factory and Reown config, and every RPC host in the CSP (the admin one).
  if (command === 'build') {
    const env = { ...loadEnv(mode, '.', 'VITE_'), PROD: mode === 'production' }
    loadConfig(env)
    checkBuildEnv(env, 'Content-Security-Policy: ' + ADMIN_CSP)
    // The login page's Turnstile widget needs the site key; without it the owner cannot sign in.
    if (env.PROD && !env.VITE_TURNSTILE_SITE_KEY) throw new Error('VITE_TURNSTILE_SITE_KEY is required in a production admin build')
  }

  return {
    root: 'admin',
    // The env files stay in app/, shared with the public build.
    envDir: '..',
    publicDir: false,
    plugins: [react()],
    server: { port: 5175 },
    build: {
      outDir: '../dist-admin',
      emptyOutDir: true,
      manifest: 'manifest.json',
      // Same reasoning as vite.config.ts: wagmi and the wallet code are large and load with the login page.
      chunkSizeWarningLimit: 1400,
      rolldownOptions: {
        input: {
          login: fileURLToPath(new URL('./admin/login.html', import.meta.url)),
          main: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
        },
      },
    },
  }
})
