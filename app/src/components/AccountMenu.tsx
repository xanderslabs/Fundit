import { type KeyboardEvent, type Ref, type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Address } from 'viem'
import { type AccountKind, useAccount } from '../lib/account'
import { signOutEmail } from '../lib/circleEmail'
import { clearEmailSession } from '../lib/emailAccount'
import { clearWalletSession } from '../lib/walletAccount'
import { disconnectWallet } from '../lib/walletSession'
import { Blockie } from './Blockie'
import { Name } from './Name'
import { SignInOptions } from './SignInOptions'
import { Dialog } from './ui'
import './AccountMenu.css'

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
  // Runs after a sign-in with the kind of account that opened.
  onSignedIn?: (kind: AccountKind) => void
  buttonRef?: Ref<HTMLButtonElement>
}

// One dialog with every way to sign in: email (when on) and Connect a wallet.
export function SignInButton({ className = 'ui-btn ui-btn-primary', label = 'Sign in', onSignedIn, buttonRef }: SignInProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const headingId = useId()
  const refocus = useRef(false)

  function dismiss() {
    refocus.current = true
    setOpen(false)
  }

  // Focus goes back to Sign in after the Dialog has unmounted and closed the native dialog, so the page behind
  // is no longer inert. A browser that does not focus a clicked button (Safari) would otherwise lose focus.
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    trigger.current?.focus()
  }, [open])

  function setTrigger(el: HTMLButtonElement | null) {
    trigger.current = el
    if (typeof buttonRef === 'function') buttonRef(el)
    else if (buttonRef) buttonRef.current = el
  }

  return (
    <>
      <button ref={setTrigger} type="button" className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog open={open} size="sm" labelledBy={headingId} onClose={dismiss}>
        <SignInOptions
          headingId={headingId}
          onSignedIn={(kind) => {
            setOpen(false)
            onSignedIn?.(kind)
          }}
        />
      </Dialog>
    </>
  )
}

const ChevronDown = () => (
  <svg className="account-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// The top bar control: Sign in when signed out, else the account pill and its menu.
export function AccountControl() {
  const account = useAccount()
  const signIn = useRef<HTMLButtonElement>(null)
  const [focusSignIn, setFocusSignIn] = useState(false)

  // After Sign out the pill is gone, so focus lands on the Sign in button that replaces it.
  useEffect(() => {
    if (focusSignIn && account === null) {
      signIn.current?.focus()
      setFocusSignIn(false)
    }
  }, [focusSignIn, account])

  if (!account) {
    return <SignInButton className="ui-btn ui-btn-primary" buttonRef={signIn} />
  }
  return <AccountMenu address={account.address} onSignedOut={() => setFocusSignIn(true)} />
}

// Sign out for the account menu and My page. It clears both account stores, and a wallet sign-in's connection goes
// too; with none connected that does nothing. An email account's Worker cookies are cleared in the background.
// Then it goes to the home page, so nobody is left on a page that needs an account.
export function useSignOut(): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    disconnectWallet()
    clearWalletSession()
    // Reads the email store before it is cleared below, and never throws.
    void signOutEmail()
    clearEmailSession()
    navigate('/')
  }, [navigate])
}

function AccountMenu({ address, onSignedOut }: { address: Address; onSignedOut: () => void }) {
  const signOutNow = useSignOut()
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
    signOutNow()
    setOpen(false)
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
        {/* The account's picture and its name or short address. Never the email address, which would show on a shared screen. */}
        <Blockie address={address} />
        <Name address={address} link={false} avatar={false} />
        <ChevronDown />
      </button>
      {open && (
        <div className="popover account-popover">
          <ul ref={menu} id={menuId} role="menu" aria-label="Account" className="account-menu" onKeyDown={onMenuKeyDown}>
            <li role="none">
              <Link role="menuitem" tabIndex={-1} to="/create" onClick={() => close(false)}>
                Start a Fundit
              </Link>
            </li>
            <li role="none">
              <Link role="menuitem" tabIndex={-1} to="/me" onClick={() => close(false)}>
                My page
              </Link>
            </li>
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
