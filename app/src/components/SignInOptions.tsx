import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { EMAIL_SIGNIN } from '../config'
import { type AccountKind, clearOtherSessions } from '../lib/account'
import { saveEmailSession } from '../lib/emailAccount'
import { saveWalletSession } from '../lib/walletAccount'
import { EmailLogin } from './EmailLogin'
import { PasskeyLogin } from './PasskeyLogin'
import { Button } from './ui'
import './SignInOptions.css'

// The wallet list loads wagmi, so it loads only when the person picks Connect a wallet.
const ConnectWallet = lazy(() => import('./ConnectWallet').then((m) => ({ default: m.ConnectWallet })))

type View = 'choose' | 'email' | 'wallet'

// The sign-in dialog body: passkey first (the existing PasskeyLogin views), then Continue with email (only with
// VITE_EMAIL_SIGNIN=1) and Connect a wallet. onSignedIn gets the kind once an account is open.
export function SignInOptions({ onSignedIn, headingId, onLeave }: { onSignedIn: (kind: AccountKind) => void; headingId?: string; onLeave?: () => void }) {
  const [view, setView] = useState<View>('choose')
  const switched = useRef(false)
  const back = useRef<HTMLButtonElement>(null)

  // The old view's controls are gone after a switch, so focus moves to the new view's Back button.
  useEffect(() => {
    if (switched.current && view !== 'choose') back.current?.focus()
  }, [view])

  function switchTo(next: View) {
    switched.current = true
    setView(next)
  }

  if (view === 'choose') {
    return (
      <div className="signin-options">
        <PasskeyLogin
          headingId={headingId}
          onLeave={onLeave}
          onDone={() => {
            clearOtherSessions('passkey')
            onSignedIn('passkey')
          }}
        />
        <p className="signin-or">or</p>
        {EMAIL_SIGNIN && (
          <Button variant="secondary" size="lg" block onClick={() => switchTo('email')}>
            Continue with email
          </Button>
        )}
        <Button variant="secondary" size="lg" block onClick={() => switchTo('wallet')}>
          Connect a wallet
        </Button>
      </div>
    )
  }

  return (
    <div className="signin-options">
      <h2 id={headingId} className="ui-dialog-title">
        {view === 'wallet' ? 'Connect a wallet' : 'Continue with email'}
      </h2>
      {view === 'wallet' && (
        <Suspense fallback={<p className="connect-note">Loading wallets...</p>}>
          <ConnectWallet
            onConnected={(address, connectorId) => {
              saveWalletSession({ address, connectorId })
              clearOtherSessions('wallet')
              onSignedIn('wallet')
            }}
          />
        </Suspense>
      )}
      {view === 'email' && (
        <EmailLogin
          onDone={(session) => {
            saveEmailSession(session)
            clearOtherSessions('email')
            onSignedIn('email')
          }}
        />
      )}
      <button ref={back} type="button" className="link-button signin-back" onClick={() => setView('choose')}>
        Back to all sign-in options
      </button>
    </div>
  )
}
