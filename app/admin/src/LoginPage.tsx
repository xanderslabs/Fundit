import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { ConnectWallet } from '../../src/components/ConnectWallet'
import { AddressChip, Button, Card } from '../../src/components/ui'
import { TURNSTILE_SITE_KEY } from '../../src/config'
import { currentTheme } from '../../src/lib/theme'
import { loadTurnstile, type Turnstile } from '../../src/lib/turnstile'
import { afterSignIn } from './lib/panelPaths'
import { signIn } from './lib/siweLogin'
import { Logo } from './ui/Logo'
import { adminWagmiConfig } from './wagmi'
import '../../src/components/Form.css'

const CHECK_FAILED = "We couldn't confirm you're not a bot. Try again."
const CHECK_PENDING = 'Wait a moment for the check to finish, then try again.'

// Step 1 connects the owner wallet, step 2 is the Turnstile check, step 3 signs the message and logs in.
export function LoginPage() {
  const [address, setAddress] = useState<Address | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<{ turnstile: Turnstile; id: string } | null>(null)

  // The widget draws once a wallet is connected, since its box is not on the page before that.
  useEffect(() => {
    if (!address) return
    let live = true
    loadTurnstile().then(
      (turnstile) => {
        if (!live || !box.current) return
        const id = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          // Its own 'auto' follows the device, not a theme picked in the panel.
          theme: currentTheme(),
          callback: (t) => {
            setToken(t)
            setError((e) => (e === CHECK_FAILED || e === CHECK_PENDING ? null : e))
          },
          'error-callback': () => {
            setToken(null)
            setError(CHECK_FAILED)
          },
          'expired-callback': () => setToken(null),
        })
        if (id) widget.current = { turnstile, id }
      },
      () => {
        if (live) setError(CHECK_FAILED)
      },
    )
    return () => {
      live = false
      if (widget.current) widget.current.turnstile.remove(widget.current.id)
      widget.current = null
    }
  }, [address])

  async function submit() {
    if (!address || busy) return
    if (!token) {
      setError(CHECK_PENDING)
      return
    }
    setBusy(true)
    setError(null)
    const result = await signIn(adminWagmiConfig, address, token)
    if (result.ok) {
      // The Worker shows this page on any panel path while signed out, so the owner lands on the page they asked for.
      location.assign(afterSignIn(location.pathname, location.search))
      return
    }
    setError(result.text)
    // A Turnstile token works once. The next try gets a fresh check.
    setToken(null)
    if (widget.current) widget.current.turnstile.reset(widget.current.id)
    setBusy(false)
  }

  return (
    <main className="admin-login">
      <Logo />
      <Card label="Sign in">
        <div className="admin-login-body">
          <div>
            <h1 className="admin-login-title">Sign in</h1>
            <p className="admin-note">Sign in with the Fundit owner wallet.</p>
          </div>
          {!address ? (
            <ConnectWallet config={adminWagmiConfig} onConnected={setAddress} />
          ) : (
            <>
              <p className="admin-login-wallet">
                Wallet <AddressChip address={address} />
              </p>
              <div ref={box} className="admin-turnstile" />
              <Button size="lg" block loading={busy} onClick={() => void submit()}>
                Sign in
              </Button>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Card>
    </main>
  )
}
