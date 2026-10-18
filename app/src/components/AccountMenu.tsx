import { useAppKit } from '@reown/appkit/react'
import { type KeyboardEvent, type Ref, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Address } from 'viem'
import { useDisconnect } from 'wagmi'
import { PASSKEYS_ENABLED } from '../config'
import { useWalletChoice } from '../hooks/useSender'
import { logoutPasskey, usePasskeySession } from '../lib/passkey'
import { Name } from './Name'
import { PasskeyLogin } from './PasskeyLogin'

// Closes an open popover when a pointer goes down outside it.
function useOutsideClose(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, root, close])
}

type SignInProps = {
  className?: string
  label?: string
  // Runs when the person starts signing in: the wallet modal or the sign-in panel opens.
  onStart?: () => void
  // Runs when the sign-in panel closes without a sign-in (Escape, a click outside, or the button again).
  onDismiss?: () => void
  // Runs after a passkey sign-in. The top bar sends a new passkey user to fund their wallet.
  onPasskeyDone?: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

// Without passkeys, Sign in opens the wallet modal. With passkeys, it opens a small panel that offers both.
export function SignInButton(props: SignInProps) {
  const { open: openWallet } = useAppKit()
  const { className = 'btn', label = 'Sign in', onStart, buttonRef } = props
  if (!PASSKEYS_ENABLED) {
    return (
      <button
        ref={buttonRef}
        type="button"
        className={className}
        onClick={() => {
          onStart?.()
          void openWallet()
        }}
      >
        {label}
      </button>
    )
  }
  return <SignInPopover {...props} className={className} label={label} />
}

function SignInPopover({ className, label, onStart, onDismiss, onPasskeyDone, buttonRef }: SignInProps) {
  const { open: openWallet } = useAppKit()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()

  function dismiss() {
    setOpen(false)
    onDismiss?.()
  }
  useOutsideClose(open, root, dismiss)

  // Focus moves into the panel when it opens, to its first control.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button, input')?.focus()
  }, [open])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    dismiss()
    trigger.current?.focus()
  }

  function setTrigger(el: HTMLButtonElement | null) {
    trigger.current = el
    if (typeof buttonRef === 'function') buttonRef(el)
    else if (buttonRef) buttonRef.current = el
  }

  return (
    <div ref={root} className="popover-anchor" onKeyDown={onKeyDown}>
      <button
        ref={setTrigger}
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) return dismiss()
          setOpen(true)
          onStart?.()
        }}
      >
        {label}
      </button>
      {open && (
        <div ref={panel} id={panelId} className="popover signin-panel">
          <button
            type="button"
            className="btn signin-wallet"
            onClick={() => {
              setOpen(false)
              void openWallet()
            }}
          >
            Use a wallet
          </button>
          <p className="signin-or" aria-hidden="true">
            or
          </p>
          <PasskeyLogin
            onDone={() => {
              setOpen(false)
              onPasskeyDone?.()
            }}
          />
        </div>
      )}
    </div>
  )
}

const ChevronDown = () => (
  <svg className="account-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// The top bar control: Sign in when signed out, else the account pill and its menu.
export function AccountControl() {
  const choice = useWalletChoice()
  const session = usePasskeySession()
  const navigate = useNavigate()
  const signIn = useRef<HTMLButtonElement>(null)
  const [focusSignIn, setFocusSignIn] = useState(false)

  // After Sign out the pill is gone, so focus lands on the Sign in button that replaces it.
  useEffect(() => {
    if (focusSignIn && choice.active === null) {
      signIn.current?.focus()
      setFocusSignIn(false)
    }
  }, [focusSignIn, choice.active])

  const address = choice.active === 'passkey' ? session?.address : choice.active === 'external' ? choice.external : null
  if (!address) {
    return <SignInButton buttonRef={signIn} onPasskeyDone={() => navigate('/fund')} />
  }
  return <AccountMenu address={address} onSignedOut={() => setFocusSignIn(true)} />
}

function AccountMenu({ address, onSignedOut }: { address: Address; onSignedOut: () => void }) {
  const choice = useWalletChoice()
  const session = usePasskeySession()
  const { mutate: disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const menuId = useId()
  useOutsideClose(open, root, () => setOpen(false))

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  useEffect(() => {
    if (open) items()[0]?.focus()
  }, [open])

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) button.current?.focus()
  }

  function onButtonKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  function onMenuKeyDown(e: KeyboardEvent) {
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (e.key === 'ArrowDown') next = (i + 1) % list.length
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    else if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    } else if (e.key === 'Tab') {
      close(false)
      return
    }
    if (next !== null) {
      e.preventDefault()
      list[next]?.focus()
    }
  }

  function signOut() {
    setOpen(false)
    if (choice.external) disconnect()
    if (session) logoutPasskey()
    onSignedOut()
  }

  return (
    <div ref={root} className="popover-anchor">
      <button
        ref={button}
        type="button"
        className="account-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
      >
        <Name address={address} link={false} />
        <ChevronDown />
      </button>
      {open && (
        <div className="popover account-popover">
          {choice.both && (
            <p className="account-note">Using your {choice.active === 'passkey' ? 'passkey wallet' : 'connected wallet'}</p>
          )}
          <ul ref={menu} id={menuId} role="menu" aria-label="Account" className="account-menu" onKeyDown={onMenuKeyDown}>
            <li role="none">
              <Link role="menuitem" tabIndex={-1} to="/create" onClick={() => close(false)}>
                Start a fundraiser
              </Link>
            </li>
            <li role="none">
              <Link role="menuitem" tabIndex={-1} to="/me" onClick={() => close(false)}>
                My page
              </Link>
            </li>
            {PASSKEYS_ENABLED && session && (
              <li role="none">
                <Link role="menuitem" tabIndex={-1} to="/fund" onClick={() => close(false)}>
                  Passkey wallet
                </Link>
              </li>
            )}
            {choice.both && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    choice.setActive(choice.active === 'passkey' ? 'external' : 'passkey')
                    close(true)
                  }}
                >
                  {choice.active === 'passkey' ? 'Use connected wallet' : 'Use passkey wallet'}
                </button>
              </li>
            )}
            <li role="none">
              <button type="button" role="menuitem" tabIndex={-1} onClick={signOut}>
                Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
