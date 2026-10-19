import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Embed } from './pages/Embed'
import './styles/tokens.css'
import './styles/base.css'
import './styles/embed.css'

// Entry for /embed/c/:address, the card other sites put in an iframe. It is its own page (embed.html), so it
// loads none of the wallet code (wagmi, AppKit) the main app needs.
const match = /^\/embed\/c\/([^/]+)\/?$/.exec(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Embed address={match?.[1] ?? ''} origin={window.location.origin} />
  </StrictMode>,
)
