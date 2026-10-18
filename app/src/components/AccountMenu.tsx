import { type KeyboardEvent, type ReactNode, type Ref, type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Address } from 'viem'
import { useDisconnect } from 'wagmi'
import { dismissBackupPrompt, logoutPasskey, readPasskeyUsername, type StoredPasskey, useBackupPrompt, usePasskeySession } from '../lib/passkey'
import { ADD_MONEY_PATH } from '../lib/urls'
import { AddBackupPasskey, confirmLeave } from './AddBackupPasskey'
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
  // Runs after a passkey sign-in. The top bar sends a new passkey user to add money to their account.
  onPasskeyDone?: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// A modal dialog. Focus moves to its first control and stays inside: Tab wraps at the ends. Escape, a click on
// the backdrop and the Close button all call onClose, unless canClose returns false.
function ModalDialog({
  labelledBy,
  onClose,
  canClose,
  children,
}: {
  labelledBy: string
  onClose: () => void
  canClose?: () => boolean
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (typeof d.showModal === 'function' && !d.open) d.showModal()
    else d.setAttribute('open', '')
    d.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [])

  // The native dialog is closed first, so the page behind is no longer inert when focus goes back to it.
  function close() {
    if (canClose && !canClose()) return
    const d = dialog.current
    if (d?.open && typeof d.close === 'function') d.close()
    onClose()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const list = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return
    const active = document.activeElement as HTMLElement | null
    const inside = active !== null && list.includes(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialog}
      className="share-dialog signin-dialog"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === dialog.current) close()
      }}
    >
      <div className="share-dialog-body">
        {children}
        <button type="button" className="share-close" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </dialog>
  )
}

// Sign-in is passkey only: the dialog opens the Fundit account sign-in and nothing else. The wallet modal never
// opens from here; it opens only inside Add money.
export function SignInButton({ className = 'btn', label = 'Sign in', onPasskeyDone, buttonRef }: SignInProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const headingId = useId()

  function dismiss() {
    setOpen(false)
    trigger.current?.focus()
  }

  function setTrigger(el: HTMLButtonElement | null) {
    trigger.current = el
    if (typeof buttonRef === 'function') buttonRef(el)
    else if (buttonRef) buttonRef.current = el
  }

  // Every entry point opens on the Sign in view. Create your account is one switch away inside the dialog.
  return (
    <>
      <button ref={setTrigger} type="button" className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <ModalDialog labelledBy={headingId} onClose={dismiss}>
          <div className="signin-body">
            <PasskeyLogin
              headingId={headingId}
              onLeave={() => setOpen(false)}
              onDone={() => {
                setOpen(false)
                onPasskeyDone?.()
              }}
            />
          </div>
        </ModalDialog>
      )}
    </>
  )
}

// Right after sign-up: the backup prompt as a dialog over whatever page the person is on.
// Closing while the words are on screen asks first. Leaving drops the words.
function BackupDialog({ stored }: { stored: StoredPasskey }) {
  const headingId = useId()
  const guard = useRef<string | null>(null)
  const onGuardChange = useCallback((message: string | null) => {
    guard.current = message
  }, [])
  return (
    <ModalDialog labelledBy={headingId} onClose={dismissBackupPrompt} canClose={() => !guard.current || window.confirm(guard.current)}>
      <AddBackupPasskey
        stored={stored}
        headingId={headingId}
        onLater={dismissBackupPrompt}
        onDone={dismissBackupPrompt}
        onGuardChange={onGuardChange}
      />
    </ModalDialog>
  )
}

const ChevronDown = () => (
  <svg className="account-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// The top bar control: Sign in when signed out, else the account pill and its menu.
export function AccountControl() {
  const session = usePasskeySession()
  const backupPrompt = useBackupPrompt(session)
  const navigate = useNavigate()
  const signIn = useRef<HTMLButtonElement>(null)
  const [focusSignIn, setFocusSignIn] = useState(false)

  // After Sign out the pill is gone, so focus lands on the Sign in button that replaces it.
  useEffect(() => {
    if (focusSignIn && session === null) {
      signIn.current?.focus()
      setFocusSignIn(false)
    }
  }, [focusSignIn, session])

  if (!session) {
    return <SignInButton buttonRef={signIn} onPasskeyDone={() => navigate(ADD_MONEY_PATH)} />
  }
  return (
    <>
      <AccountMenu address={session.address} onSignedOut={() => setFocusSignIn(true)} />
      {backupPrompt && <BackupDialog stored={session} />}
    </>
  )
}

// Sign out for the account menu and My page. Recovery words on screen would be lost, so it asks first like any
// other way out. A wallet connected to add money goes too; with none connected that does nothing. True when the
// person signed out.
export function useSignOut(): () => boolean {
  const { mutate: disconnect } = useDisconnect()
  return useCallback(() => {
    if (!confirmLeave()) return false
    disconnect()
    logoutPasskey()
    return true
  }, [disconnect])
}

function AccountMenu({ address, onSignedOut }: { address: Address; onSignedOut: () => void }) {
  const signOutNow = useSignOut()
  // The passkey's username when this browser knows it, else the name or short address.
  const username = readPasskeyUsername(address)
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
    if (!signOutNow()) return
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
        {username ? (
          <span className="name" title={address}>
            <span className="name-text">{username}</span>
          </span>
        ) : (
          <Name address={address} link={false} />
        )}
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
              <Link role="menuitem" tabIndex={-1} to={ADD_MONEY_PATH} onClick={() => close(false)}>
                Add money
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
