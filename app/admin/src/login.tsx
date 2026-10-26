import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import './ui/admin-theme.css'
import './admin.css'
import { applyStoredTheme } from './lib/theme'
import { LoginPage } from './LoginPage'

applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginPage />
  </StrictMode>,
)
