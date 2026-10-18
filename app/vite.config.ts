import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
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
  // Fail the production build, not the deployed page, when the factory or Reown config is missing, when
  // the Circle client key for passkey sign-in is missing, or when an RPC host is missing from the CSP.
  if (command === 'build') {
    const env = { ...loadEnv(mode, '.', 'VITE_'), PROD: mode === 'production' }
    loadConfig(env)
    checkBuildEnv(env, readFileSync(fileURLToPath(new URL('./public/_headers', import.meta.url)), 'utf8'))
  }

  return {
    plugins: [react(), embedRewrite()],
    // Unit tests run on the defaults (mainnet), never on a developer's .env.local, which the e2e suite sets to
    // testnet.
    ...(mode === 'test' && { envDir: false as const }),
    build: {
      // The AppKit vendor chunk (about 1,320 kB minified, 360 kB gzipped) all loads at start, so splitting
      // it further would not shrink the first load. Raise the limit just above it.
      chunkSizeWarningLimit: 1400,
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          embed: fileURLToPath(new URL('./embed.html', import.meta.url)),
        },
        output: {
          // Keep the wallet libraries in their own long-cached chunks, apart from app code. The $initial
          // tag limits each group to modules on the first-load graph, so lazy AppKit views stay lazy.
          codeSplitting: {
            groups: [
              { name: 'appkit', test: /node_modules[\\/](@reown|@walletconnect|lit|@lit|lit-html|lit-element)[\\/]/, tags: ['$initial'], priority: 1 },
              { name: 'wagmi', test: /node_modules[\\/](wagmi|@wagmi|@tanstack)[\\/]/, tags: ['$initial'], priority: 2 },
              { name: 'viem', test: /node_modules[\\/](viem|ox|abitype|@noble|@scure)[\\/]/, tags: ['$initial'], priority: 3 },
              // React on its own, so the embed page (embed.html) shares it without loading the wagmi chunk.
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
