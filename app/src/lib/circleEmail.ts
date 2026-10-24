import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk'
import type { Error as SdkError, ThemeColor } from '@circle-fin/w3s-pw-web-sdk/dist/src/types'
import { getAddress, isAddress } from 'viem'
import { CIRCLE_UCW_APP_ID } from '../config'
import { openCircleWindow } from './circleWindow'
import {
  clearEmailTokens,
  EmailError,
  type EmailSession,
  type EmailTokens,
  readEmailSession,
  readEmailTokens,
  saveEmailTokens,
  tagEmailTokens,
  ucw,
} from './emailAccount'

// Circle's user-controlled wallets web SDK for email accounts: the code screen at sign-in and the approval window
// for every challenge. The SDK (with its Node polyfills) loads only from here, on first use, in its own chunk.
// Never log a token, a key or an SDK result: they can carry both.

export type ChallengeOutcome = { kind: 'done'; data: unknown } | { kind: 'cancelled' }

// Circle's codes the app acts on.
export const CIRCLE_CODE = {
  userTokenExpired: 155104,
  alreadyInitialized: 155106,
  userCanceled: 155701,
  networkError: 155706,
  // Circle's code screen stays open after these, so the person can type the code again.
  otpInvalid: 155133,
  otpNotMatch: 155134,
} as const

// The person closed Circle's window, or asked it for a new code. Nothing went wrong.
export class EmailLoginStopped extends Error {
  constructor(readonly newCode: boolean) {
    super(newCode ? 'New code requested' : 'Closed')
  }
}

// Fundit's colours (src/styles/tokens.css) on Circle's screens. Circle applies only some of them (Gate 1, U6).
const THEME: ThemeColor = {
  bg: '#ffffff',
  backdrop: '#101928',
  backdropOpacity: 0.4,
  divider: '#e4e8eb',
  textMain: '#101928',
  textMain2: '#101928',
  textAuxiliary: '#586283',
  textAuxiliary2: '#586283',
  textSummary: '#101928',
  textInteractive: '#0f7a14',
  success: '#19b820',
  error: '#c0150b',
  inputBg: '#ffffff',
  inputText: '#101928',
  inputBorderFocused: '#586283',
  mainBtnBg: '#19b820',
  mainBtnBgOnHover: '#0f7a14',
  mainBtnText: '#ffffff',
  mainBtnTextOnHover: '#ffffff',
  secondBtnText: '#101928',
  secondBtnBorder: '#d5dade',
  secondBtnBorderOnHover: '#586283',
  plainBtnText: '#0f7a14',
}

const appSettings = () => ({ appId: CIRCLE_UCW_APP_ID })
// The SDK's one frame. Its own id; the SDK adds and removes it.
const FRAME_ID = 'sdkIframe'
const WALLET_TRIES = 8
const WALLET_WAIT_MS = 1500

type Ready = { sdk: W3SSdk; deviceId: string }
let ready: Promise<Ready> | null = null

function sdkError(e: SdkError | undefined, fallback: string): EmailError {
  return new EmailError(e?.message ?? fallback, null, typeof e?.code === 'number' ? e.code : null)
}

// The SDK's dependencies (jsonwebtoken and its crypto polyfills) read Node's process, Buffer and global, some as
// soon as they load. vite.config.ts injects none of them, so the first load stays as it was; they are set here.
async function setNodeGlobals() {
  const g = globalThis as { process?: unknown; Buffer?: unknown; global?: unknown }
  const [process, buffer] = await Promise.all([import('vite-plugin-node-polyfills/shims/process'), import('vite-plugin-node-polyfills/shims/buffer')])
  g.process ??= process.default
  g.Buffer ??= buffer.default
  g.global ??= globalThis
}

// One SDK for the page. getDeviceId() must run right after it is made, or later challenges silently do nothing
// (Gate 1). A failed load is forgotten, so the next try loads again.
function circle(): Promise<Ready> {
  ready ??= (async () => {
    await setNodeGlobals()
    const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
    const sdk = new W3SSdk({ appSettings: appSettings() })
    sdk.setThemeColor(THEME)
    let deviceId: string
    try {
      deviceId = await sdk.getDeviceId()
    } catch {
      throw new EmailError('Circle did not answer', null, CIRCLE_CODE.networkError)
    }
    return { sdk, deviceId }
  })().catch((err: unknown) => {
    ready = null
    throw err
  })
  return ready
}

export async function loadCircleSdk(): Promise<W3SSdk> {
  return (await circle()).sdk
}

// Settles when Circle's window goes away with no answer: the SDK removes its frame on close and calls nothing.
// Only a frame that was shown counts, so a page change before the SDK adds it is not a close.
function onFrameClosed(then: () => void): () => void {
  let seen = document.getElementById(FRAME_ID) !== null
  const observer = new MutationObserver(() => {
    const present = document.getElementById(FRAME_ID) !== null
    if (present) seen = true
    else if (seen) {
      observer.disconnect()
      then()
    }
  })
  observer.observe(document.body, { childList: true })
  return () => observer.disconnect()
}

function closeFrame() {
  document.getElementById(FRAME_ID)?.remove()
}

// Asks the Worker to email a code (after its Turnstile check), opens Circle's code screen, and resolves once the
// tokens from a right code are with the Worker. onWrongCode runs for a wrong code while the screen stays open.
// Rejects with EmailLoginStopped if the person closes the screen or asks for a new code, else with EmailError.
export async function sendEmailCode(email: string, turnstile: string, onWrongCode?: (err: EmailError) => void): Promise<void> {
  const { sdk, deviceId } = await circle()
  const values = await ucw<Record<string, unknown>>('email-token', { deviceId, email, turnstile })
  const { deviceToken, deviceEncryptionKey, otpToken } = values
  if (typeof deviceToken !== 'string' || typeof deviceEncryptionKey !== 'string' || typeof otpToken !== 'string') {
    throw new EmailError('Circle gave no login values', 502, null)
  }
  // An open Fundit dialog steps aside until the code screen closes (circleWindow).
  const shown = openCircleWindow()
  let tokens: { userToken: string; encryptionKey: string; refreshToken: string }
  try {
    tokens = await new Promise<{ userToken: string; encryptionKey: string; refreshToken: string }>((resolve, reject) => {
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        stopWatching()
        fn()
      }
      const stopWatching = onFrameClosed(() => finish(() => reject(new EmailLoginStopped(false))))
      sdk.updateConfigs({ appSettings: appSettings(), loginConfigs: { deviceToken, deviceEncryptionKey, otpToken } }, (error, result) => {
        if (error || !result) {
          const err = sdkError(error, 'Login failed')
          if (err.code === CIRCLE_CODE.otpInvalid || err.code === CIRCLE_CODE.otpNotMatch) {
            onWrongCode?.(err)
            return
          }
          closeFrame()
          finish(() => reject(err))
          return
        }
        finish(() => resolve({ userToken: result.userToken, encryptionKey: result.encryptionKey, refreshToken: result.refreshToken }))
      })
      sdk.setOnResendOtpEmail(() => {
        // A new code needs a new Turnstile check, which only the form can give.
        closeFrame()
        finish(() => reject(new EmailLoginStopped(true)))
      })
      sdk.verifyOtp()
    })
  } finally {
    shown()
  }
  // Once, so the Worker can keep userToken and refreshToken in HttpOnly cookies.
  await ucw('login', tokens)
  // Not tied to a wallet until openEmailAccount knows it.
  saveEmailTokens({ userToken: tokens.userToken, encryptionKey: tokens.encryptionKey }, null)
}

type CircleWallet = { id?: unknown; address?: unknown }

// After a login: Circle's create step for a new person (one approval), then the wallet's address. Rejects with
// EmailLoginStopped if the person closes the create step.
export async function openEmailAccount(email: string): Promise<EmailSession> {
  let challengeId: unknown
  try {
    const init = await ucw<{ data?: { challengeId?: unknown } }>('initialize')
    challengeId = init.data?.challengeId
  } catch (err) {
    // Already set up: the person signed in before, and the wallet exists.
    if (!(err instanceof EmailError && err.code === CIRCLE_CODE.alreadyInitialized)) throw err
  }
  if (typeof challengeId === 'string') {
    const outcome = await runChallenge(challengeId)
    if (outcome.kind === 'cancelled') throw new EmailLoginStopped(false)
  }
  // The new wallet can take a moment to show up after the create step.
  for (let i = 0; i < WALLET_TRIES; i++) {
    const out = await ucw<{ data?: { wallets?: CircleWallet[] } }>('wallets')
    const w = out.data?.wallets?.find((x) => typeof x.id === 'string' && typeof x.address === 'string' && isAddress(x.address))
    if (w) {
      tagEmailTokens(w.id as string)
      return { address: getAddress(w.address as string), walletId: w.id as string, email }
    }
    await new Promise((r) => setTimeout(r, WALLET_WAIT_MS))
  }
  throw new EmailError('No wallet found', 502, null)
}

// New tokens from the Worker's cookies. A refusal (401) signs the email account out and asks the person to sign in
// again (ucw). Anything else (Circle down) is thrown as it is.
export async function refreshEmailTokens(): Promise<EmailTokens> {
  const { deviceId } = await circle()
  const t = await ucw<Record<string, unknown>>('session', { deviceId })
  if (typeof t.userToken !== 'string' || typeof t.encryptionKey !== 'string') throw new EmailError('Circle gave no tokens', 502, null)
  const tokens = { userToken: t.userToken, encryptionKey: t.encryptionKey }
  saveEmailTokens(tokens)
  return tokens
}

// The tokens Circle's window needs: this tab's copy, else fresh ones from the Worker (a new tab or a reload).
export async function ensureEmailTokens(): Promise<EmailTokens> {
  return readEmailTokens() ?? refreshEmailTokens()
}

// Opens Circle's window for a challenge and waits for the person. Closing it, or Circle's own cancel (155701),
// is 'cancelled'. data is the SDK result's data, such as signedTransaction for a sign request.
// Another tab may have refreshed the session, leaving this tab an old user token that the Worker never sees (its
// cookies are fresh). Circle's window then fails with 155104: the tokens are refreshed once and the same challenge
// runs again. A second failure is thrown as it is.
export async function runChallenge(challengeId: string): Promise<ChallengeOutcome> {
  const [{ sdk }, tokens] = await Promise.all([circle(), ensureEmailTokens()])
  try {
    return await executeChallenge(sdk, tokens, challengeId)
  } catch (err) {
    if (!(err instanceof EmailError && err.code === CIRCLE_CODE.userTokenExpired)) throw err
    closeFrame()
    return executeChallenge(sdk, await refreshEmailTokens(), challengeId)
  }
}

// An open Fundit dialog steps aside until Circle's window closes (circleWindow).
async function executeChallenge(sdk: W3SSdk, tokens: EmailTokens, challengeId: string): Promise<ChallengeOutcome> {
  sdk.setAuthentication(tokens)
  const shown = openCircleWindow()
  try {
    return await new Promise<ChallengeOutcome>((resolve, reject) => {
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        stopWatching()
        fn()
      }
      const stopWatching = onFrameClosed(() => finish(() => resolve({ kind: 'cancelled' })))
      sdk.execute(challengeId, (error, result) => {
        if (error) {
          if (error.code === CIRCLE_CODE.userCanceled) finish(() => resolve({ kind: 'cancelled' }))
          else finish(() => reject(sdkError(error, 'Challenge failed')))
          return
        }
        finish(() => resolve({ kind: 'done', data: (result as { data?: unknown } | undefined)?.data }))
      })
    })
  } finally {
    shown()
  }
}

// Signs the email account out: the Worker drops its cookies and this tab forgets the tokens. Never throws, so
// Sign out always finishes.
export async function signOutEmail(): Promise<void> {
  const had = readEmailSession() !== null || readEmailTokens() !== null
  clearEmailTokens()
  if (!had) return
  try {
    await ucw('signout')
  } catch {
    // The email store is already gone, so the app no longer uses the cookies. They expire on their own.
  }
}
