import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadConfig } from './src/deployConfig.ts'

export default defineConfig(({ command, mode }) => {
  // Fail the production build, not the deployed page, when the factory or Reown config is missing.
  if (command === 'build') loadConfig({ ...loadEnv(mode, '.', 'VITE_'), PROD: mode === 'production' })

  return {
    plugins: [react()],
    build: {
      // The AppKit vendor chunk (about 1,320 kB minified, 360 kB gzipped) all loads at start, so splitting
      // it further would not shrink the first load. Raise the limit just above it.
      chunkSizeWarningLimit: 1400,
      rolldownOptions: {
        output: {
          // Keep the wallet libraries in their own long-cached chunks, apart from app code. The $initial
          // tag limits each group to modules on the first-load graph, so lazy AppKit views stay lazy.
          codeSplitting: {
            groups: [
              { name: 'appkit', test: /node_modules[\\/](@reown|@walletconnect|lit|@lit|lit-html|lit-element)[\\/]/, tags: ['$initial'], priority: 1 },
              { name: 'wagmi', test: /node_modules[\\/](wagmi|@wagmi|@tanstack)[\\/]/, tags: ['$initial'], priority: 2 },
              { name: 'viem', test: /node_modules[\\/](viem|ox|abitype|@noble|@scure)[\\/]/, tags: ['$initial'], priority: 3 },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
    },
  }
})
