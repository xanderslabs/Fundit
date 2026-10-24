import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { checkBuildEnv, loadConfig } from './src/deployConfig.ts'

// /embed/c/:address is served by embed.html, a separate page with no wallet code. Cloudflare does the same
// rewrite with public/_redirects; this does it for the dev and preview servers.
function embedRewrite(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url?.startsWith('/embed/')) req.url = '/embed.html'
    next()
  }
  return {
    name: 'fundit-embed-rewrite',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  // Fail the production build, not the deployed page, when the factory or Reown config is missing, or when an
  // RPC host is missing from the CSP.
  if (command === 'build') {
    const env = { ...loadEnv(mode, '.', 'VITE_'), PROD: mode === 'production' }
    loadConfig(env)
    checkBuildEnv(env, readFileSync(fileURLToPath(new URL('./public/_headers', import.meta.url)), 'utf8'))
  }

  return {
    // Circle's user-controlled wallets SDK (email accounts) imports jsonwebtoken, which needs these Node built-ins in
    // the browser. Only these modules are polyfilled, and they load with the SDK's lazy chunk. No globals are
    // injected: injection reaches every module (react-dom reads process), so the first load would grow. The SDK's
    // process, Buffer and global are set by lib/circleEmail.ts just before it loads.
    plugins: [
      react(),
      embedRewrite(),
      nodePolyfills({ include: ['buffer', 'crypto', 'stream', 'util'], globals: { Buffer: false, global: false, process: false } }),
    ],
    // Unit tests run on the defaults (mainnet), never on a developer's .env.local, which the e2e suite sets to
    // testnet.
    ...(mode === 'test' && { envDir: false as const }),
    build: {
      // wagmi loads only when a wallet tab in Add money opens, and the bridge SDK loads on demand too. Its
      // largest chunk is about 660 kB minified, not on the first load. Raise the limit above it.
      chunkSizeWarningLimit: 1400,
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          embed: fileURLToPath(new URL('./embed.html', import.meta.url)),
        },
        output: {
          // Keep the libraries on the first load in their own long-cached chunks, apart from app code. The
          // $initial tag limits each group to modules on the first-load graph. wagmi is not on it:
          // it loads with the Add money wallet tabs (components/WalletTabs.tsx).
          codeSplitting: {
            groups: [
              { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, tags: ['$initial'], priority: 2 },
              { name: 'viem', test: /node_modules[\\/](viem|ox|abitype|@noble|@scure)[\\/]/, tags: ['$initial'], priority: 3 },
              // React on its own, so the embed page (embed.html) shares it without loading the query chunk.
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, tags: ['$initial'], priority: 4 },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      // Playwright runs e2e/ against Arc testnet (npm run e2e).
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }
})
