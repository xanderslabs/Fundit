import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyStoredTheme } from './lib/theme'
import './styles/tokens.css'
import './styles/base.css'
import './styles/theme.css'

// Before the first render, so a dark device never sees a light flash (the CSP allows no inline script).
applyStoredTheme()

// No wallet code at start. Wallet sign-in and the bridge tab load wagmi when they open (components/WalletTabs.tsx).
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
