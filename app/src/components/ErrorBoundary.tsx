import { Component, type ReactNode } from 'react'
import { Button, StatusBox } from './ui'
import './Form.css'
import './ErrorBoundary.css'

const UPDATED = 'Fundit was updated. Reload the page to continue.'
const CRASHED = "That didn't work. Reload the page and try again."

// What browsers say when a lazy chunk cannot load: after a deploy, a tab on the old build asks for a file the
// site no longer serves. Vite's CSS preload says the last one. The error may sit in the cause chain.
const CHUNK_FAILED = /dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i

function isChunkError(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { name, message } = e as { name?: unknown; message?: unknown }
    if ((typeof message === 'string' && CHUNK_FAILED.test(message)) || name === 'ChunkLoadError') return true
  }
  return false
}

type State = { error: unknown; failed: boolean }

// Catches a crash below it, so the page shows a plain message and a Reload button instead of going blank.
// main.tsx puts one around the app, and Add money one around each lazy wallet tab, so only that tab fails.
// The raw error goes to the console, never to the page.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="error-boundary">
        <StatusBox tone="error">
          <p>{isChunkError(this.state.error) ? UPDATED : CRASHED}</p>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <a href={`/report?from=${encodeURIComponent(window.location.pathname)}`}>Report a problem</a>
          </div>
        </StatusBox>
      </div>
    )
  }
}
