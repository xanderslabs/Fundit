// Gate 1 test page (Plan 7): Circle user-controlled wallets for email and Google sign-in on Arc testnet. Throwaway,
// served at /gate1 for the run and then deleted. Nothing in the app imports or links to it.
//
// The Circle API key lives only in the gate Worker (worker/index.ts); this page calls /api/ucw/*. Login tokens are
// kept in sessionStorage so the Google redirect and a reload keep the session (test only; never shown or logged).
import { type LoginCompleteCallback, SocialLoginProvider, type ThemeColor } from '@circle-fin/w3s-pw-web-sdk/dist/src/types'
import { type Address, encodeFunctionData, type Hex, parseAbi, recoverMessageAddress } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { NETWORK, TOKENS } from '../config'
import { arcClient } from '../lib/clients'
import { maskEmails, sanitize, serializeError, toJson } from '../gate0/lib'

if (NETWORK.name !== 'testnet') {
  document.body.textContent = 'Gate 1 runs on Arc testnet only.'
  throw new Error('Gate 1 runs on Arc testnet only')
}

const APP_ID = import.meta.env.VITE_CIRCLE_UCW_APP_ID as string | undefined
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const REDIRECT_URI = `${location.origin}/gate1`
const USDC = TOKENS.USDC.address as Address
const MULTICALL3FROM: Address = '0x522fAf9A91c41c443c66765030741e4AaCe147D0'
// The test gift goes back to the testnet funder.
const FUNDER: Address = '0x8c910BbB14543D12B295d0c7d6FfC109b7b9f1da'
const GIFT = 10_000n // 0.01 USDC
const APPROVE_MARK = 7n

// Fundit's tokens (src/styles/tokens.css) for Circle's confirmation and OTP screens.
const FUNDIT_THEME: ThemeColor = {
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

const multicallAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])'])

// ---------- page output ----------

const results: Record<string, unknown> = {}
const logLines: string[] = []
const $ = (id: string) => document.getElementById(id)!

function log(line: string, data?: unknown) {
  const text = `${new Date().toISOString().slice(11, 23)} ${line}${data === undefined ? '' : ` ${toJson(sanitize(data))}`}`
  logLines.push(maskEmails(text))
  $('log').textContent = logLines.join('\n')
}

function record(key: string, value: unknown) {
  results[key] = sanitize(value)
  $('results').textContent = toJson({ ...results, notes: maskEmails(($('notes') as HTMLTextAreaElement).value) })
}

// ---------- session (sessionStorage, test only) ----------

type Session = {
  deviceId?: string
  deviceToken?: string
  deviceEncryptionKey?: string
  otpToken?: string
  userToken?: string
  encryptionKey?: string
  refreshToken?: string
  loginAt?: number
  method?: 'google' | 'email'
  walletId?: string
  address?: Address
  googleStartedAt?: number
}
const KEY = 'fundit-gate1'
function load(): Session {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Session
  } catch {
    return {}
  }
}
let session = load()
function save(patch: Partial<Session>) {
  session = { ...session, ...patch }
  sessionStorage.setItem(KEY, JSON.stringify(session))
  renderStatus()
}

function renderStatus() {
  $('network').textContent = `Arc ${NETWORK.name}`
  $('status-login').textContent = session.userToken ? `yes (${session.method}, ${Math.round((Date.now() - (session.loginAt ?? 0)) / 60000)} min ago)` : 'no'
  $('status-wallet').textContent = session.address ?? 'none'
}

// ---------- Worker calls ----------

async function api(route: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  let passphrase = sessionStorage.getItem(`${KEY}-passphrase`)
  if (!passphrase) {
    passphrase = prompt('Gate passphrase') ?? ''
    sessionStorage.setItem(`${KEY}-passphrase`, passphrase)
  }
  const res = await fetch(`/api/ucw/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gate-passphrase': passphrase },
    body: JSON.stringify(body),
  })
  if (res.status === 401) sessionStorage.removeItem(`${KEY}-passphrase`)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  log(`api ${route} -> ${res.status}`, data)
  return { status: res.status, data }
}

function payload(data: Record<string, unknown>): Record<string, unknown> {
  return (data.data as Record<string, unknown>) ?? {}
}

// ---------- SDK ----------

type Sdk = import('@circle-fin/w3s-pw-web-sdk').W3SSdk
let sdk: Sdk | null = null
let themed = true

function loginConfigs() {
  return {
    deviceToken: session.deviceToken ?? '',
    deviceEncryptionKey: session.deviceEncryptionKey ?? '',
    ...(session.otpToken && { otpToken: session.otpToken }),
    ...(GOOGLE_CLIENT_ID && { google: { clientId: GOOGLE_CLIENT_ID, redirectUri: REDIRECT_URI, selectAccountPrompt: true } }),
  }
}

const onLogin: LoginCompleteCallback = (error, result) => {
  if (error || !result) {
    log('login failed', serializeError(error))
    record(session.method === 'email' ? 'U2_email' : 'U1_google', { ok: false, error: serializeError(error) })
    return
  }
  const ms = session.googleStartedAt ? Date.now() - session.googleStartedAt : undefined
  save({ userToken: result.userToken, encryptionKey: result.encryptionKey, refreshToken: result.refreshToken, loginAt: Date.now(), otpToken: undefined })
  // oAuthInfo carries the Google profile. Only which fields exist is kept, never their values.
  record(session.method === 'email' ? 'U2_email' : 'U1_google', { ok: true, msFromStart: ms, oAuthInfoFields: 'oAuthInfo' in result && result.oAuthInfo ? Object.keys(result.oAuthInfo) : null })
  log(`signed in with ${session.method}`)
}

async function startSdk() {
  if (!APP_ID) {
    $('status-sdk').textContent = 'VITE_CIRCLE_UCW_APP_ID missing'
    return
  }
  const t0 = performance.now()
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
  sdk = new W3SSdk({ appSettings: { appId: APP_ID }, loginConfigs: loginConfigs() }, onLogin)
  if (themed) sdk.setThemeColor(FUNDIT_THEME)
  const deviceId = await sdk.getDeviceId()
  if (session.deviceId && session.deviceId !== deviceId) log('deviceId changed since last load')
  save({ deviceId })
  $('status-sdk').textContent = `ready (${Math.round(performance.now() - t0)} ms)`
  record('U0_sdk', { ok: true, loadMs: Math.round(performance.now() - t0), deviceIdStable: true })
}

function runChallenge(challengeId: string): Promise<{ ms: number; result: unknown }> {
  return new Promise((resolve, reject) => {
    if (!sdk || !session.userToken || !session.encryptionKey) return reject(new Error('Sign in first'))
    sdk.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey })
    const t0 = performance.now()
    sdk.execute(challengeId, (error, result) => {
      const ms = Math.round(performance.now() - t0)
      log(`challenge ${challengeId.slice(0, 8)} done in ${ms} ms`, error ? serializeError(error) : result)
      if (error) reject(Object.assign(error, { ms }))
      else resolve({ ms, result })
    })
  })
}

async function waitTx(id: string): Promise<Record<string, unknown>> {
  const t0 = performance.now()
  const seen: string[] = []
  for (;;) {
    const { data } = await api('transaction', { userToken: session.userToken, id })
    const tx = (payload(data).transaction ?? {}) as Record<string, unknown>
    const state = String(tx.state ?? 'unknown')
    if (seen.at(-1) !== state) seen.push(state)
    if (['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED'].includes(state)) return { ...tx, states: seen, msToTerminal: Math.round(performance.now() - t0) }
    if (performance.now() - t0 > 180_000) return { ...tx, states: seen, timedOut: true }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

async function refreshBalance() {
  if (!session.address) return
  const bal = await arcClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [session.address] })
  $('status-balance').textContent = `${Number(bal) / 1e6}`
  return bal
}

// ---------- gift ----------

async function latestTx(): Promise<Record<string, unknown> | undefined> {
  const { data } = await api('latest-transaction', { userToken: session.userToken, walletId: session.walletId })
  return ((payload(data).transactions ?? []) as Record<string, unknown>[])[0]
}

async function gift(id: string, mode: 'LOW' | 'MEDIUM' | 'custom') {
  if (!session.walletId || !session.address) throw new Error('Run U3 first')
  const before = await refreshBalance()
  const callData = encodeFunctionData({
    abi: multicallAbi,
    functionName: 'aggregate3',
    args: [
      [
        { target: USDC, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [FUNDER, APPROVE_MARK] }) },
        { target: USDC, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [FUNDER, GIFT] }) },
      ],
    ],
  })
  let fee: Record<string, string>
  if (mode === 'custom') {
    const block = await arcClient.getBlock()
    const base = block.baseFeePerGas ?? 20_000_000_000n
    const gas = await arcClient.estimateGas({ account: session.address, to: MULTICALL3FROM, data: callData })
    const gwei = (wei: bigint) => (Number(wei) / 1e9).toFixed(9).replace(/\.?0+$/, '')
    fee = { maxFee: gwei(base * 2n + 1_000_000_000n), priorityFee: '1', gasLimit: ((gas * 125n) / 100n).toString() }
  } else {
    fee = { feeLevel: mode }
  }
  const previous = (await latestTx())?.id
  const t0 = performance.now()
  const ex = await api('execute', { userToken: session.userToken, walletId: session.walletId, contractAddress: MULTICALL3FROM, callData, ...fee })
  const challengeId = payload(ex.data).challengeId
  if (!challengeId) {
    record(`${id}_gift`, { mode, fee, rejected: ex.data })
    return
  }
  const approval = await runChallenge(String(challengeId))
  // The SDK result carries no transaction id, so the newest transaction for this wallet is followed instead.
  let tx: Record<string, unknown> | undefined
  for (let i = 0; i < 60; i++) {
    const latest = await latestTx()
    if (latest && latest.id !== previous) {
      tx = await waitTx(String(latest.id))
      break
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  const hash = tx?.txHash as Hex | undefined
  let chain: Record<string, unknown> = {}
  if (hash) {
    const r = await arcClient.getTransactionReceipt({ hash })
    const t = await arcClient.getTransaction({ hash })
    const allowance = await arcClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [session.address, FUNDER] })
    chain = {
      status: r.status,
      gasUsed: r.gasUsed.toString(),
      gasLimit: t.gas.toString(),
      priorityGwei: Number(t.maxPriorityFeePerGas ?? 0n) / 1e9,
      effectiveGwei: Number(r.effectiveGasPrice) / 1e9,
      feeUsdc: Number(r.gasUsed * r.effectiveGasPrice) / 1e18,
      approveFromWallet: allowance === APPROVE_MARK,
    }
  }
  const after = await refreshBalance()
  record(`${id}_gift`, { mode, fee, approvalMs: approval.ms, totalMs: Math.round(performance.now() - t0), states: tx?.states, hash, chain, balanceBefore: before?.toString(), balanceAfter: after?.toString() })
}

// ---------- checks ----------

type Check = { id: string; title: string; text: string; run: () => Promise<void>; extra?: () => HTMLElement }

const emailInput = document.createElement('input')
emailInput.type = 'email'
emailInput.placeholder = 'you@example.com'

const checks: Check[] = [
  {
    id: 'U1',
    title: 'U1 Sign in with Google',
    text: 'Gets a device token from the Worker, then sends you to Google and back to this page.',
    async run() {
      if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID missing')
      const { data } = await api('social-token', { deviceId: session.deviceId })
      const p = payload(data)
      if (!p.deviceToken) throw new Error('No device token')
      save({ deviceToken: String(p.deviceToken), deviceEncryptionKey: String(p.deviceEncryptionKey), method: 'google', googleStartedAt: Date.now() })
      sdk!.updateConfigs({ appSettings: { appId: APP_ID! }, loginConfigs: loginConfigs() }, onLogin)
      await sdk!.performLogin(SocialLoginProvider.GOOGLE)
    },
  },
  {
    id: 'U2',
    title: 'U2 Sign in with email',
    text: 'Circle emails a code through our SMTP setup, then shows its own code screen.',
    extra: () => emailInput,
    async run() {
      const email = emailInput.value.trim()
      if (!email) throw new Error('Type an email first')
      const t0 = Date.now()
      const { data } = await api('email-token', { deviceId: session.deviceId, email })
      const p = payload(data)
      if (!p.deviceToken) throw new Error('No device token')
      save({ deviceToken: String(p.deviceToken), deviceEncryptionKey: String(p.deviceEncryptionKey), otpToken: String(p.otpToken), method: 'email', googleStartedAt: t0 })
      sdk!.updateConfigs({ appSettings: { appId: APP_ID! }, loginConfigs: loginConfigs() }, onLogin)
      sdk!.verifyOtp()
    },
  },
  {
    id: 'U3',
    title: 'U3 Create or load the wallet',
    text: 'Asks Circle for an EOA wallet on Arc testnet. A new user approves a "create wallet" step first.',
    async run() {
      const t0 = performance.now()
      const init = await api('initialize', { userToken: session.userToken })
      let created = false
      let challengeMs: number | undefined
      if (init.status < 300 && payload(init.data).challengeId) {
        challengeMs = (await runChallenge(String(payload(init.data).challengeId))).ms
        created = true
      } else if (init.data.code !== 155106) {
        throw new Error(`initialize failed: ${toJson(init.data)}`)
      }
      // The wallet can take a moment to appear after the create challenge.
      let wallets: Record<string, unknown>[] = []
      for (let i = 0; i < 20 && wallets.length === 0; i++) {
        wallets = (payload((await api('wallets', { userToken: session.userToken })).data).wallets ?? []) as Record<string, unknown>[]
        if (wallets.length === 0) await new Promise((r) => setTimeout(r, 1500))
      }
      const w = wallets[0]
      if (!w) throw new Error('No wallet found')
      save({ walletId: String(w.id), address: String(w.address) as Address })
      const code = await arcClient.getCode({ address: session.address! })
      record('U3_wallet', { ok: true, created, challengeMs, totalMs: Math.round(performance.now() - t0), count: wallets.length, accountType: w.accountType, blockchain: w.blockchain, custodyType: w.custodyType, state: w.state, address: w.address, onChainCode: code ?? '0x' })
      await refreshBalance()
    },
  },
  ...(
    [
      ['U4a', 'LOW', "Circle's LOW fee level."],
      ['U4b', 'custom', 'Our own fee: Arc base fee x2 plus a 1 gwei tip, gas limit from our estimate + 25%. Circle may reject a tip below its minimum.'],
      ['U4c', 'MEDIUM', "Circle's MEDIUM fee level (the first run paid a 234 gwei tip)."],
    ] as const
  ).map(([id, mode, text]): Check => ({
    id,
    title: `${id} Gift with ${mode} fee: approve + transfer in one Multicall3From transaction`,
    text: `One Circle approval. Approves the funder for 7 units and sends 0.01 USDC to the funder. ${text}`,
    run: () => gift(id, mode),
  })),
  {
    id: 'U5',
    title: 'U5 Sign a message',
    text: 'Circle signs a plain message. The page checks the signature recovers to the wallet.',
    async run() {
      if (!session.walletId || !session.address) throw new Error('Run U3 first')
      const message = `Fundit gate 1 test ${new Date().toISOString()}`
      const res = await api('sign-message', { userToken: session.userToken, walletId: session.walletId, message })
      const challengeId = payload(res.data).challengeId
      if (!challengeId) throw new Error(`sign failed: ${toJson(res.data)}`)
      const out = await runChallenge(String(challengeId))
      const signature = (out.result as { data?: { signature?: Hex } } | undefined)?.data?.signature
      const recovered = signature ? await recoverMessageAddress({ message, signature }) : null
      record('U5_sign', { ms: out.ms, hasSignature: !!signature, recoversToWallet: recovered?.toLowerCase() === session.address.toLowerCase() })
    },
  },
  {
    id: 'U6',
    title: 'U6 Theme on or off',
    text: 'Toggles Fundit colours on Circle screens. Run U4 or U5 again after toggling to compare.',
    async run() {
      themed = !themed
      if (themed) sdk!.setThemeColor(FUNDIT_THEME)
      else sdk!.setThemeColor({})
      record('U6_theme', { themed })
    },
  },
  {
    id: 'U7',
    title: 'U7 Session after reload',
    text: 'Reload the page first, then press this. Lists wallets with the saved token, then tries a token refresh.',
    async run() {
      const w = await api('wallets', { userToken: session.userToken })
      const r = await api('refresh', { userToken: session.userToken, refreshToken: session.refreshToken, deviceId: session.deviceId })
      const p = payload(r.data)
      if (p.userToken) save({ userToken: String(p.userToken), encryptionKey: String(p.encryptionKey ?? session.encryptionKey), refreshToken: String(p.refreshToken ?? session.refreshToken) })
      record('U7_session', { minutesSinceLogin: Math.round((Date.now() - (session.loginAt ?? 0)) / 60000), walletsStatus: w.status, refreshStatus: r.status, refreshFields: Object.keys(p) })
    },
  },
  {
    id: 'U8',
    title: 'U8 Sign out',
    text: 'Forgets the tokens on this page. Run U1 or U2 again with the same account: U3 must load the same address.',
    async run() {
      const address = session.address
      session = { deviceId: session.deviceId }
      sessionStorage.setItem(KEY, JSON.stringify(session))
      renderStatus()
      record('U8_signout', { previousAddress: address })
    },
  },
]

function renderChecks() {
  const root = $('checks')
  for (const c of checks) {
    const s = document.createElement('section')
    const h = document.createElement('h2')
    h.textContent = c.title
    const p = document.createElement('p')
    p.textContent = c.text
    const row = document.createElement('div')
    row.className = 'row'
    if (c.extra) row.append(c.extra())
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `Run ${c.id}`
    b.onclick = async () => {
      b.disabled = true
      try {
        await c.run()
      } catch (err) {
        log(`${c.id} failed`, serializeError(err))
        record(`${c.id}_error`, serializeError(err))
      } finally {
        b.disabled = false
      }
    }
    row.append(b)
    s.append(h, p, row)
    root.append(s)
  }
}

$('copy').onclick = () => void navigator.clipboard.writeText(`${$('results').textContent}\n\nLOG\n${logLines.join('\n')}`)
$('notes').oninput = () => record('page', { at: new Date().toISOString() })

renderStatus()
renderChecks()
window.addEventListener('error', (e) => log('window error', e.message))
window.addEventListener('unhandledrejection', (e) => log('unhandled rejection', serializeError(e.reason)))
void startSdk().catch((err) => {
  $('status-sdk').textContent = 'failed'
  log('SDK start failed', serializeError(err))
})
void refreshBalance()
