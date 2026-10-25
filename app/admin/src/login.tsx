import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import './admin.css'
import { LoginPage } from './LoginPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginPage />
  </StrictMode>,
)
