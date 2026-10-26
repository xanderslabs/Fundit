import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ADMIN_CSP } from './admin/worker/headers.ts'
import { NETWORKS } from './src/config.ts'
import { connectSrcAllows, KNOWN_FACTORIES } from './src/deployConfig.ts'

// The admin panel (admin.fundit.fun) is its own build, apart from the public site: login.html is public, index.html
// is the panel. manifest.json lists which built files each page loads, so the Worker (admin/worker/assets.ts) serves
// only the login page's files without a session.
export default defineConfig(({ command, mode }) => {
  // The admin build serves both Arc networks, so no network variable is read. It needs the WalletConnect project
  // id and the Turnstile site key (without it the owner cannot sign in), and both networks' RPCs in the CSP.
  if (command === 'build') {
    const env = loadEnv(mode, '.', 'VITE_')
    if (mode === 'production') {
      for (const name of ['VITE_REOWN_PROJECT_ID', 'VITE_TURNSTILE_SITE_KEY'] as const) {
        if (!env[name]) throw new Error(`${name} is required in a production admin build`)
      }
    }
    for (const n of Object.values(NETWORKS)) {
      for (const url of [n.rpcUrl, ...n.chain.rpcUrls.default.http]) {
        if (!connectSrcAllows('Content-Security-Policy: ' + ADMIN_CSP, url)) throw new Error(`${url} (Arc ${n.name}) is not allowed by connect-src in ADMIN_CSP`)
      }
    }
  }

  return {
    root: 'admin',
    // src/config.ts still reads one network's values at import (and refuses a production build with no factory).
    // The admin code never uses them, so they are fixed to mainnet here, whatever the env files or the build
    // environment set. A define wins over Vite's env loading for these names.
    define: {
      'import.meta.env.VITE_ARC_NETWORK': JSON.stringify('mainnet'),
      'import.meta.env.VITE_FACTORY_ADDRESS': JSON.stringify(KNOWN_FACTORIES.mainnet.address),
      'import.meta.env.VITE_FACTORY_DEPLOY_BLOCK': JSON.stringify(String(KNOWN_FACTORIES.mainnet.deployBlock)),
    },
    // The env files stay in app/, shared with the public build.
    envDir: '..',
    // admin/public holds only the font the pages load. The Worker serves it before sign-in (worker/assets.ts).
    publicDir: 'public',
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
