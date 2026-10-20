// Gate 0 test page for the sign-in options (Plan 7 Task 0). Throwaway, Arc testnet only, served at /gate0.html for
// the run and then deleted. Nothing in the app imports or links to it. It has its own AppKit instance and touches no
// app state except what AppKit and wagmi keep in this origin's storage.
//
// Secrets: the throwaway EOAs live only in this module's memory (generatePrivateKey) and are never shown, logged or
// copied. Results and the log go through sanitize (lib.ts), which redacts token, key and session fields and masks
// emails.
import * as sdk from '@circle-fin/modular-wallets-core'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { createStorage, getWalletClient } from '@wagmi/core'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  type LocalAccount,
  parseAbi,
  recoverMessageAddress,
  toHex,
  type Transport,
} from 'viem'
import { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount, toAccount } from 'viem/accounts'
import { erc20Abi } from '../abi/erc20'
import {
  ARC_CHAIN,
  ARC_RPC_URL,
  CIRCLE_CLIENT_KEY,
  CIRCLE_MSCA_FACTORY,
  CIRCLE_MULTISIG_PLUGIN,
  EXPLORER_URL,
  FALLBACK_GAS_DEPLOYED,
  FALLBACK_GAS_NEW_ACCOUNT,
  MODULAR_WALLETS_URL,
  NETWORK,
  REOWN_PROJECT_ID,
  TOKENS,
} from '../config'
import { arcClient } from '../lib/clients'
import { standInCalls } from '../lib/passkey'
import { type Call, withGasMargin } from '../lib/sender'
import { CRED_TYPES, emailPaths, factoryArgs, type FactoryOwner, maskEmails, pluginAbi, publicKeyXY, sanitize, serializeError, toJson, usdcNeeded } from './lib'

// Arc testnet only. A mainnet build stops here, before AppKit or any Circle call.
if (NETWORK.name !== 'testnet') {
  document.body.textContent = 'Gate 0 runs on Arc testnet only.'
  throw new Error('Gate 0 runs on Arc testnet only')
}

// ---------- page output ----------

const results: Record<string, unknown> = {}
const logLines: string[] = []
// Errors, AppKit events and console errors in order, for G10.
const captured: { at: string; source: string; value: unknown }[] = []

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function now() {
  return new Date().toISOString()
}

function render() {
  $('results').textContent = toJson(results)
}

function log(message: string, data?: unknown) {
  const line = `${now()} ${maskEmails(message)}${data === undefined ? '' : ` ${JSON.stringify(sanitize(data))}`}`
  logLines.push(line)
  const el = $('log')
  el.textContent = logLines.join('\n')
  el.scrollTop = el.scrollHeight
}

function link(label: string, url: string) {
  const li = document.createElement('li')
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = `${label}: ${url}`
  li.append(a)
  $('links').append(li)
  log(`link ${label} ${url}`)
}

const txUrl = (hash: Hex) => `${EXPLORER_URL}/tx/${hash}`
const addressUrl = (address: Address) => `${EXPLORER_URL}/address/${address}`
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

class StepFailed extends Error {}

// One check's results. step records a value or the raw error and stops the check on an error; probe records the
// same but carries on, for steps expected to fail (reverts, empty mappings).
function check(id: string) {
  const out: Record<string, unknown> = { startedAt: now() }
  results[id] = out
  render()
  log(`${id} started`)
  async function run<T>(name: string, fn: () => Promise<T>, stop: boolean): Promise<T | undefined> {
    log(`${id} ${name} ...`)
    const t0 = performance.now()
    try {
      const value = await fn()
      out[name] = { ms: Math.round(performance.now() - t0), value: sanitize(value) }
      log(`${id} ${name} ok`, value)
      return value
    } catch (err) {
      const error = serializeError(err)
      out[name] = { ms: Math.round(performance.now() - t0), error }
      captured.push({ at: now(), source: `${id}.${name}`, value: error })
      log(`${id} ${name} FAILED`, error)
      if (stop) throw new StepFailed(name)
      return undefined
    } finally {
      render()
    }
  }
  return {
    set(key: string, value: unknown) {
      out[key] = sanitize(value)
      render()
    },
    step: <T>(name: string, fn: () => Promise<T>) => run(name, fn, true) as Promise<T>,
    probe: <T>(name: string, fn: () => Promise<T>) => run(name, fn, false),
    done() {
      out.finishedAt = now()
      render()
      log(`${id} finished`)
    },
  }
}
type Check = ReturnType<typeof check>

// Runs a button's work once at a time and keeps the page alive on any error.
function button(parent: HTMLElement, label: string, fn: () => Promise<void>) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', async () => {
    b.disabled = true
    try {
      await fn()
    } catch (err) {
      if (!(err instanceof StepFailed)) {
        captured.push({ at: now(), source: label, value: serializeError(err) })
        log(`${label} FAILED`, serializeError(err))
      }
    } finally {
      b.disabled = false
    }
  })
  parent.append(b)
  return b
}

// ---------- Circle and Arc ----------

const CLIENT_URL = `${MODULAR_WALLETS_URL}/v1/rpc/w3s/buidl`
const circleTransport = sdk.toModularTransport(`${CLIENT_URL}${NETWORK.modularChainPath}`, CIRCLE_CLIENT_KEY) as unknown as Transport
// Circle's RPC: circle_getAddress, the address mappings and the bundler.
const circleClient = createPublicClient({ chain: ARC_CHAIN, transport: circleTransport })

type Req = { calls: Call[] } | { callData: Hex }
type Gas = { callGasLimit: bigint; preVerificationGas: bigint; verificationGasLimit: bigint }
type Receipt = { success: boolean; reason?: string; actualGasCost: bigint; actualGasUsed: bigint; receipt: { transactionHash: Hex } }
type Bundler = {
  estimateUserOperationGas(args: { account: unknown } & Req): Promise<Gas>
  sendUserOperation(args: { account: unknown } & Req & Gas): Promise<Hex>
  waitForUserOperationReceipt(args: { hash: Hex; timeout?: number }): Promise<Receipt>
}

async function circleLowFee() {
  const { low } = await sdk.getUserOperationGasPrice(circleClient as never)
  return { maxFeePerGas: BigInt(low.maxFeePerGas), maxPriorityFeePerGas: BigInt(low.maxPriorityFeePerGas) }
}

// Built like sendingBundler in lib/passkey.ts: Circle's transport, Circle's low fee tier.
const bundlerClient = createBundlerClient({ chain: ARC_CHAIN, transport: circleTransport, userOperation: { estimateFeesPerGas: circleLowFee } })
const bundler = bundlerClient as unknown as Bundler
const recovery = sdk.recoveryActions(bundlerClient as never)

type SmartAccount = Awaited<ReturnType<typeof sdk.toCircleSmartAccount>>

// The account at a known address. Built on the Arc RPC client, so the SDK does not call circle_getAddress (which can
// write a Circle wallet record for the owner and change what the mapping checks read).
function accountAt(owner: unknown, address: Address): Promise<SmartAccount> {
  return sdk.toCircleSmartAccount({ client: arcClient as never, owner: owner as never, address })
}

// Circle's own answer (circle_getAddress), as toCircleSmartAccount without an address gets it.
async function circleGetAddress(owner: unknown): Promise<Address> {
  return (await sdk.toCircleSmartAccount({ client: circleClient as never, owner: owner as never })).address
}

// The SDK's local computeAddress: toCircleSmartAccount on a client without Circle's transport.
async function sdkComputeAddress(owner: unknown): Promise<Address> {
  return (await sdk.toCircleSmartAccount({ client: arcClient as never, owner: owner as never })).address
}

// Circle's bundler refuses a sender it has no record of (-32600 "Cannot find target wallet in the system", seen live
// on 2026-10-20). The app gets that record the same way every time: it builds the account with
// toCircleSmartAccount on Circle's transport, and the SDK then always calls circle_getAddress for the owner
// (getModularWalletAddress in dist/index.mjs), even when an address is passed (connect in lib/passkey.ts). This does
// the same call and stops the check when Circle's address is not the factory's.
async function registerWithCircle(c: Check, owner: unknown, expected: Address) {
  const circle = await c.step('registerWithCircle', () => circleGetAddress(owner))
  c.set('registerWithCircle.compare', { circleGetAddress: circle, factoryAddress: expected, equal: same(circle, expected) })
  if (!same(circle, expected)) {
    log(`FAILED: Circle registered ${circle} for this owner, not the factory address ${expected}. Check stopped.`)
    throw new StepFailed('registerWithCircle')
  }
}

const factoryAbi = parseAbi(['function getAddress(bytes32 sender, bytes32 salt, bytes initializingData) view returns (address addr, bytes32 mixedSalt)'])
async function factoryAddress(owner: FactoryOwner): Promise<Address> {
  const [address] = await arcClient.readContract({ address: CIRCLE_MSCA_FACTORY, abi: factoryAbi, functionName: 'getAddress', args: factoryArgs(owner) })
  return address
}

async function owners(account: Address) {
  const code = await arcClient.getCode({ address: account })
  if (!code || code === '0x') return { deployed: false }
  const [ids, data, meta] = await arcClient.readContract({ address: CIRCLE_MULTISIG_PLUGIN, abi: pluginAbi, functionName: 'ownershipInfoOf', args: [account] })
  return {
    deployed: true,
    count: ids.length,
    ownershipMetadata: meta,
    rows: data.map((o, i) => ({
      ownerId: ids[i],
      weight: o.weight,
      credType: o.credType,
      credTypeName: CRED_TYPES[o.credType] ?? 'unknown',
      addr: o.addr,
      publicKeyX: o.publicKeyX,
      publicKeyY: o.publicKeyY,
    })),
  }
}

// Circle's raw mapping answer. An owner Circle has no record of is an error (-32602), recorded as it comes.
function mapping(owner: { eoa: Address } | { x: bigint; y: bigint }) {
  const param =
    'eoa' in owner
      ? { type: sdk.OwnerIdentifierType.EOA, identifier: { address: owner.eoa } }
      : { type: sdk.OwnerIdentifierType.WebAuthn, identifier: { publicKeyX: owner.x.toString(), publicKeyY: owner.y.toString() } }
  return sdk.getAddressMapping(circleClient as never, { owner: param } as never)
}

async function usdcOf(address: Address) {
  return arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
}

const fmtUsdc = (units: bigint) => `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, '0')}`

// Shows the account and the amount to fund, and waits until the account holds it (or the owner clicks Send now).
async function ensureFunds(c: Check, address: Address, ops: number) {
  const deployed = ((await arcClient.getCode({ address })) ?? '0x') !== '0x'
  const { maxFeePerGas } = await circleLowFee()
  const need = usdcNeeded(maxFeePerGas, deployed, ops, { newAccount: FALLBACK_GAS_NEW_ACCOUNT, deployed: FALLBACK_GAS_DEPLOYED })
  let balance = await usdcOf(address)
  c.set(`funds.${address}`, { deployed, ops, maxFeePerGas, needUsdc: fmtUsdc(need), balanceUsdc: fmtUsdc(balance) })
  if (balance >= need) return
  const box = $('funding')
  box.hidden = false
  $('fund-address').textContent = address
  ;($('fund-link') as HTMLAnchorElement).href = addressUrl(address)
  $('fund-need').textContent = fmtUsdc(need)
  log(`waiting for funds on ${address}: need ${fmtUsdc(need)} USDC`)
  let skip = false
  const onSkip = () => {
    skip = true
  }
  $('fund-skip').addEventListener('click', onSkip, { once: true })
  const until = Date.now() + 30 * 60_000
  while (!skip && balance < need && Date.now() < until) {
    $('fund-balance').textContent = fmtUsdc(balance)
    await new Promise((r) => setTimeout(r, 5_000))
    balance = await usdcOf(address).catch(() => balance)
  }
  $('fund-skip').removeEventListener('click', onSkip)
  box.hidden = true
  c.set(`funds.${address}.final`, { balanceUsdc: fmtUsdc(balance), sentWithoutFullFunds: balance < need })
  log(`funds on ${address}: ${fmtUsdc(balance)} USDC`)
}

// Estimates, sends with the app's call gas margin, and waits for the receipt. A failed estimate is a revert or a
// short account, recorded raw.
async function sendOp(c: Check, name: string, account: SmartAccount, req: Req) {
  const gas = await c.step(`${name}.estimate`, () => bundler.estimateUserOperationGas({ account, ...req }))
  const hash = await c.step(`${name}.send`, () =>
    bundler.sendUserOperation({
      account,
      ...req,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
    }),
  )
  return waitOp(c, name, hash)
}

async function waitOp(c: Check, name: string, hash: Hex) {
  const r = await c.step(`${name}.receipt`, async () => {
    const res = await bundler.waitForUserOperationReceipt({ hash, timeout: 180_000 })
    return { userOpHash: hash, success: res.success, reason: res.reason, actualGasCost: res.actualGasCost, actualGasUsed: res.actualGasUsed, txHash: res.receipt.transactionHash, explorer: txUrl(res.receipt.transactionHash) }
  })
  link(`${name} tx`, r.explorer)
  return r
}

// The owner wrapped so each signature is timed: what the person waits for while the wallet signs.
function timed(owner: LocalAccount, c: Check, name: string): LocalAccount {
  return toAccount({
    address: owner.address,
    async signMessage(p) {
      const t0 = performance.now()
      const sig = await owner.signMessage(p)
      c.set(`${name}.signMs`, Math.round(performance.now() - t0))
      return sig
    },
    signTransaction: (tx) => owner.signTransaction(tx),
    signTypedData: (td) => owner.signTypedData(td as never),
  })
}

// ---------- the checks shared by every EOA owner ----------

// G1, G2 and G4: the owner is a plain EOA on Arc, signs personal_sign of a raw 32-byte hash, opens its account at
// the factory's address, and sends one standInCalls() user operation that deploys it.
async function eoaChecks(id: string, owner: LocalAccount, send: boolean, extra: Record<string, unknown> = {}) {
  const c = check(id)
  for (const [k, v] of Object.entries(extra)) c.set(k, v)
  const E = owner.address
  c.set('owner', E)
  link(`${id} owner`, addressUrl(E))
  await c.step('ownerIsEoa', async () => {
    const code = (await arcClient.getCode({ address: E })) ?? '0x'
    if (code !== '0x') throw new Error(`The owner ${E} has code on Arc: it is a contract, not an EOA`)
    return { code }
  })
  await c.step('signRawHash', async () => {
    const hash = keccak256(toHex(`fundit gate0 ${now()}`))
    const t0 = performance.now()
    const signature = await owner.signMessage({ message: { raw: hash } })
    const signMs = Math.round(performance.now() - t0)
    const recovered = await recoverMessageAddress({ message: { raw: hash }, signature })
    if (!same(recovered, E)) throw new Error(`personal_sign recovered ${recovered}, not the owner ${E}`)
    return { hash, signature, recovered, signMs }
  })
  if (!send) return c.done()
  const factory = await c.step('factoryGetAddress', () => factoryAddress({ kind: 'eoa', address: E }))
  const computed = await c.step('sdkComputeAddress', () => sdkComputeAddress(owner))
  c.set('factoryEqualsSdk', same(factory, computed))
  await registerWithCircle(c, owner, factory)
  link(`${id} account`, addressUrl(factory))
  const account = await accountAt(timed(owner, c, 'standIn'), factory)
  await ensureFunds(c, factory, 1)
  const res = await sendOp(c, 'standIn', account, { calls: standInCalls() })
  c.set('pass.userOpSuccess', res.success)
  await c.step('deployedAfter', async () => ((await arcClient.getCode({ address: factory })) ?? '0x') !== '0x')
  c.done()
}

// ---------- AppKit, its own instance ----------

const wagmiAdapter = new WagmiAdapter({
  projectId: REOWN_PROJECT_ID,
  networks: [ARC_CHAIN],
  transports: { [ARC_CHAIN.id]: http(ARC_RPC_URL) },
  // Apart from the app's wagmi store on this origin.
  storage: createStorage({ storage: localStorage, key: 'gate0.wagmi' }),
})
const wagmiConfig = wagmiAdapter.wagmiConfig

const appKitStart = performance.now()
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId: REOWN_PROJECT_ID,
  networks: [ARC_CHAIN],
  defaultNetwork: ARC_CHAIN,
  metadata: {
    name: 'Fundit',
    description: 'Fundit Gate 0 test page',
    url: window.location.origin,
    icons: [`${window.location.origin}/images/web-app-manifest-192x192.png`],
  },
  // Fundit needs a plain EOA that owns the Circle account, never Reown's smart account.
  defaultAccountTypes: { eip155: 'eoa' },
  features: {
    email: true,
    socials: ['google'],
    emailShowWallets: true,
    analytics: false,
    swaps: false,
    onramp: false,
    history: false,
    send: false,
    receive: false,
    smartSessions: false,
    pay: false,
  },
  enableCoinbase: false,
  enableBaseAccount: false,
})

function accountInfo() {
  const raw = appKit.getAccount('eip155')
  return { account: raw, emailPaths: emailPaths(raw), walletInfo: appKit.getWalletInfo('eip155') }
}

async function appKitOwner(c?: Check): Promise<LocalAccount> {
  const info = accountInfo()
  c?.set('appKitAccount', info)
  const walletClient = await getWalletClient(wagmiConfig)
  c?.set('walletClientChainId', walletClient.chain?.id)
  return sdk.walletClientToLocalAccount(walletClient as never) as unknown as LocalAccount
}

// G3: time to ready() and what AppKit restored, on every load.
appKit
  .ready()
  .then(() => {
    const info = accountInfo()
    results.G3_load = sanitize({ at: now(), readyMs: Math.round(performance.now() - appKitStart), status: info.account?.status, isConnected: info.account?.isConnected, address: info.account?.address, embeddedWalletInfo: info.account?.embeddedWalletInfo, emailPaths: info.emailPaths })
    render()
    log('AppKit ready', results.G3_load)
  })
  .catch((err) => {
    results.G3_load = { at: now(), readyMs: Math.round(performance.now() - appKitStart), error: serializeError(err) }
    captured.push({ at: now(), source: 'appKit.ready', value: serializeError(err) })
    render()
    log('AppKit ready FAILED', serializeError(err))
  })

let firstConnected = true
appKit.subscribeAccount((a) => {
  $('status-appkit').textContent = `${a.status ?? 'unknown'} ${a.address ?? ''}`
  if (a.isConnected && firstConnected) {
    firstConnected = false
    results.G3_firstConnectedMs = Math.round(performance.now() - appKitStart)
    render()
  }
  log('AppKit account', { status: a.status, address: a.address, embeddedWalletInfo: a.embeddedWalletInfo })
}, 'eip155')

// The events store notifies on every change (pending events, flushes), so the same event comes back many times. Each
// event is logged once, and INITIALIZE only the first time.
let lastEvent = ''
let initializeLogged = false
appKit.subscribeEvents((e) => {
  const name = (e.data as { event?: string } | undefined)?.event ?? ''
  const key = `${e.timestamp}:${name}`
  if (key === lastEvent) return
  lastEvent = key
  if (name === 'INITIALIZE') {
    if (initializeLogged) return
    initializeLogged = true
  }
  const data = sanitize(e.data)
  captured.push({ at: now(), source: 'appkit.event', value: data })
  log('AppKit event', data)
})

const openView = (view: string) => () => appKit.open({ view } as never).then(() => log(`opened ${view}`))

// ---------- passkeys and throwaway EOAs ----------

type Passkey = { credential: Awaited<ReturnType<typeof sdk.toWebAuthnCredential>>; owner: unknown; xy: { x: bigint; y: bigint }; account: Address }
let passkey: Passkey | null = null

async function newPasskey(mode: 'Register' | 'Login', credentialId?: string): Promise<Passkey> {
  const credential = await sdk.toWebAuthnCredential({
    transport: sdk.toPasskeyTransport(CLIENT_URL, CIRCLE_CLIENT_KEY),
    mode: mode === 'Register' ? sdk.WebAuthnMode.Register : sdk.WebAuthnMode.Login,
    ...(mode === 'Register' && { username: `gate0-${Date.now()}` }),
    ...(credentialId && { credentialId }),
  })
  const xy = publicKeyXY(credential.publicKey)
  const account = await factoryAddress({ kind: 'passkey', ...xy })
  return { credential, owner: toWebAuthnAccount({ credential: credential as never }), xy, account }
}

// The test passkey's credential id and account address, for this tab only, so the same account is used after a
// reload. Both are public: no key, signature or session is stored.
const PASSKEY_KEY = 'gate0.passkey'
type StoredPasskey = { credentialId: string; account: Address }

function readStoredPasskey(): StoredPasskey | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(PASSKEY_KEY) ?? 'null') as Partial<StoredPasskey> | null
    return x && typeof x.credentialId === 'string' && typeof x.account === 'string' ? { credentialId: x.credentialId, account: x.account } : null
  } catch {
    return null
  }
}

async function setPasskey(mode: 'Register' | 'Login') {
  const c = check(`passkey.${mode}`)
  const stored = mode === 'Login' ? readStoredPasskey() : null
  if (stored) c.set('storedBeforeReload', stored)
  passkey = await c.step('credential', () => newPasskey(mode, stored?.credentialId))
  c.set('account', passkey.account)
  c.set('publicKeyXY', passkey.xy)
  if (stored) c.set('sameAccountAsStored', same(stored.account, passkey.account))
  try {
    sessionStorage.setItem(PASSKEY_KEY, JSON.stringify({ credentialId: passkey.credential.id, account: passkey.account }))
  } catch {
    log('sessionStorage unavailable: the test passkey is not kept across a reload')
  }
  link('passkey account', addressUrl(passkey.account))
  $('status-passkey').textContent = passkey.account
  c.done()
}

function needPasskey(): Passkey {
  if (!passkey) throw new Error('Create or use a test passkey first (Passkey section).')
  return passkey
}

// A fresh EOA in memory only. The key never leaves this closure.
function throwawayEoa(): LocalAccount {
  return privateKeyToAccount(generatePrivateKey())
}

const addOwnersData = (eoa: Address) => encodeFunctionData({ abi: pluginAbi, functionName: 'addOwners', args: [[eoa], [1n], [], [], 0n] })
const removeOwnersData = (eoas: Address[], keys: { x: bigint; y: bigint }[] = []) =>
  encodeFunctionData({ abi: pluginAbi, functionName: 'removeOwners', args: [eoas, keys, 0n] })

// G5 (M2, M4) and G7, scripted, on the test passkey's account with two throwaway EOAs.
async function scripted() {
  const p = needPasskey()
  const c = check('G5_G7_scripted')
  const A = p.account
  c.set('account', A)
  c.set('removeOwnersAbiSource', 'explorer.testnet.arc.io verified WeightedWebauthnMultisigPlugin at 0x0000000C984AFf541D6cE86Bb697e68ec57873C8')
  c.set('removeOwnersCallPath', 'user operation callData = removeOwners(...) on the account itself, as registerRecoveryAddress sends addOwners')
  const t1 = throwawayEoa()
  const t2 = throwawayEoa()
  const t3 = throwawayEoa()
  c.set('throwaway', { t1: t1.address, t2: t2.address, t3: t3.address })
  const signer = await accountAt(p.owner, A)

  // M4: never-used EOAs, before anything touches them.
  await c.probe('M4.mapping.t1.fresh', () => mapping({ eoa: t1.address }))
  await c.probe('M4.mapping.t2.fresh', () => mapping({ eoa: t2.address }))
  // M4b: does circle_getAddress for an EOA write a mapping? toCircleSmartAccount calls it without an address.
  await c.probe('M4b.circleGetAddress.t3', () => circleGetAddress(t3))
  await c.probe('M4b.mapping.t3.afterGetAddress', () => mapping({ eoa: t3.address }))

  // The passkey's own account, registered with Circle before its first user operation. Only the passkey: the throwaway
  // EOAs are never sent through circle_getAddress, so their mapping reads stay clean.
  await registerWithCircle(c, p.owner, A)
  await ensureFunds(c, A, 4)
  await c.probe('owners.before', () => owners(A))

  // M2: a bare addOwners, no createAddressMapping.
  await sendOp(c, 'M2.addOwners.t1', signer, { callData: addOwnersData(t1.address) })
  await c.probe('M2.mapping.t1.afterBareAddOwners', () => mapping({ eoa: t1.address }))
  // G8: one passkey row and one EOA row.
  await c.probe('G8.owners.passkeyAndEoa', () => owners(A))

  // G7: the passkey removes the EOA. One owner left.
  const removed = await sendOp(c, 'G7.removeOwners.t1.byPasskey', signer, { callData: removeOwnersData([t1.address]) })
  const after = await c.probe('G7.owners.afterRemove', () => owners(A))
  c.set('pass.G7.oneOwnerLeft', removed.success && after?.deployed === true && after.count === 1)

  // G7: removing the last owner (the passkey itself), estimate only: expected to revert with EmptyOwnersNotAllowed.
  await c.probe('G7.removeLastOwner.estimate', () => bundler.estimateUserOperationGas({ account: signer, callData: removeOwnersData([], [p.xy]) }))

  // An EOA added through registerRecoveryAddress (so Circle maps it), then removed by its own signature.
  await ensureFunds(c, A, 2)
  await c.step('register.t2.estimate+send', async () => {
    const gas = await recovery.estimateRegisterRecoveryAddressGas({ account: signer, recoveryAddress: t2.address } as never)
    const hash = await recovery.registerRecoveryAddress({
      account: signer,
      recoveryAddress: t2.address,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
    } as never)
    return hash
  }).then((hash) => waitOp(c, 'register.t2', hash))
  await c.probe('mapping.t2.afterRegister', () => mapping({ eoa: t2.address }))
  const bySelf = await accountAt(timed(t2, c, 'selfRemove'), A)
  await c.probe('G7.removeSelf.t2', () => sendOp(c, 'G7.removeSelf.t2.op', bySelf, { callData: removeOwnersData([t2.address]) }))
  await c.probe('G7.owners.afterSelfRemove', () => owners(A))
  await c.probe('G7.mapping.t2.afterRemove', () => mapping({ eoa: t2.address }))
  c.done()
}

// G6a: the passkey adds the connected email EOA with registerRecoveryAddress. M1 reads the mapping after.
async function g6Register() {
  const p = needPasskey()
  const c = check('G6a_registerRecoveryAddress')
  const email = await appKitOwner(c)
  const A = p.account
  c.set('account', A)
  c.set('emailEoa', email.address)
  const signer = await accountAt(p.owner, A)
  await registerWithCircle(c, p.owner, A)
  await ensureFunds(c, A, 1)
  const gas = await c.step('estimate', () => recovery.estimateRegisterRecoveryAddressGas({ account: signer, recoveryAddress: email.address } as never))
  const hash = await c.step('send', () =>
    recovery.registerRecoveryAddress({
      account: signer,
      recoveryAddress: email.address,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
    } as never),
  )
  await waitOp(c, 'registerRecoveryAddress', hash)
  const m1 = await c.probe('M1.mapping.emailEoa', () => mapping({ eoa: email.address }))
  c.set('M1.mapsToPasskeyAccount', Array.isArray(m1) && m1.some((x: { walletAddress?: string }) => !!x.walletAddress && same(x.walletAddress, A)))
  await c.probe('owners.after', () => owners(A))
  c.done()
}

// G6b: the email EOA signs executeRecovery to add a new passkey. M3 reads Circle's answers for that passkey.
async function g6Recover() {
  const p = needPasskey()
  const c = check('G6b_executeRecovery')
  const email = await appKitOwner(c)
  const A = p.account
  c.set('account', A)
  const signer = await accountAt(timed(email, c, 'executeRecovery'), A)
  // The sender is the passkey's account, so it is registered through the passkey, as the app's own sign-in does.
  await registerWithCircle(c, p.owner, A)
  await ensureFunds(c, A, 1)
  const fresh = await c.step('newPasskey', () => newPasskey('Register'))
  c.set('newPasskey', { xy: fresh.xy, ownAccount: fresh.account })
  const base = { account: signer, credential: fresh.credential }
  const gas = await c.step('estimate', () => recovery.estimateExecuteRecoveryGas(base as never))
  const hash = await c.step('send', () =>
    recovery.executeRecovery({
      ...base,
      callGasLimit: withGasMargin(gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      verificationGasLimit: gas.verificationGasLimit,
    } as never),
  )
  await waitOp(c, 'executeRecovery', hash)
  await c.probe('owners.after', () => owners(A))
  const circle = await c.probe('M3.circleGetAddress.newPasskey', () => circleGetAddress(fresh.owner))
  if (circle) c.set('M3.circleGetAddress', { answer: circle, isOriginalAccount: same(circle, A), isOwnFactoryAddress: same(circle, fresh.account) })
  await c.probe('M3.mapping.newPasskey', () => mapping(fresh.xy))
  c.done()
}

// ---------- G4: EIP-6963 extension wallets ----------

type Announced = { info: { uuid: string; name: string; rdns: string }; provider: EIP1193Provider }
const announced = new Map<string, Announced>()
window.addEventListener('eip6963:announceProvider', (e) => {
  const d = (e as CustomEvent<Announced>).detail
  announced.set(d.info.uuid, d)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

async function g4Extension() {
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  await new Promise((r) => setTimeout(r, 500))
  const found = [...announced.values()].map((a) => ({ name: a.info.name, rdns: a.info.rdns }))
  log('EIP-6963 wallets', found)
  const metamask = [...announced.values()].find((a) => a.info.rdns === 'io.metamask')
  if (!metamask) {
    results.G4_extension = { found, error: 'MetaMask did not announce itself through EIP-6963.' }
    render()
    return
  }
  const [address] = (await metamask.provider.request({ method: 'eth_requestAccounts' })) as Address[]
  const walletClient = createWalletClient({ account: address!, chain: ARC_CHAIN, transport: custom(metamask.provider) })
  const owner = sdk.walletClientToLocalAccount(walletClient as never) as unknown as LocalAccount
  await eoaChecks('G4_extension', owner, true, { found, used: { name: metamask.info.name, rdns: metamask.info.rdns } })
}

// ---------- G9: CSP hosts ----------

const violations: { directive: string; blocked: string; disposition: string }[] = []
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, disposition: e.disposition })
})

// Every origin the page loaded from, by the CSP directive that governs it, and every request the app's own CSP
// (sent here as Content-Security-Policy-Report-Only) would block. Requests inside Reown's iframe and the Google
// popup are governed by their own pages and do not show here; the DevTools network log is the full list.
function g9() {
  const byDirective: Record<string, Set<string>> = {}
  const add = (d: string, origin: string) => (byDirective[d] ??= new Set()).add(origin)
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    let origin: string
    try {
      origin = new URL(entry.name).origin
    } catch {
      continue
    }
    if (origin === window.location.origin) continue
    const t = entry.initiatorType
    const d = t === 'iframe' ? 'frame-src' : t === 'img' || t === 'image' ? 'img-src' : t === 'script' ? 'script-src' : t === 'css' || t === 'link' ? 'style-src or font-src' : 'connect-src'
    add(d, origin)
  }
  for (const f of document.querySelectorAll('iframe')) {
    try {
      add('frame-src', new URL(f.src).origin)
    } catch {
      // An iframe without a src.
    }
  }
  const wouldBlock: Record<string, Set<string>> = {}
  for (const v of violations) (wouldBlock[v.directive] ??= new Set()).add(v.blocked)
  const asLists = (o: Record<string, Set<string>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]))
  results.G9 = { at: now(), loadedByDirective: asLists(byDirective), appCspWouldBlock: asLists(wouldBlock), violations }
  render()
  log('G9 collected')
}

// ---------- G10: raw errors per case ----------

window.addEventListener('error', (e) => captured.push({ at: now(), source: 'window.error', value: serializeError(e.error ?? e.message) }))
window.addEventListener('unhandledrejection', (e) => captured.push({ at: now(), source: 'unhandledrejection', value: serializeError(e.reason) }))
for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    captured.push({ at: now(), source: `console.${level}`, value: args.map((a) => (a instanceof Error ? serializeError(a) : sanitize(a))) })
    original(...args)
  }
}

let caseMark: { name: string; index: number } | null = null

async function signOnce() {
  const c = check('G10_signOnce')
  const owner = await c.step('owner', () => appKitOwner(c))
  await c.step('signRawHash', () => owner.signMessage({ message: { raw: keccak256(toHex(`fundit gate0 ${now()}`)) } }))
  c.done()
}

// ---------- the page ----------

function section(title: string, text: string) {
  const s = document.createElement('section')
  const h = document.createElement('h2')
  h.textContent = title
  const p = document.createElement('p')
  p.textContent = text
  const row = document.createElement('div')
  row.className = 'row'
  s.append(h, p, row)
  $('checks').append(s)
  return row
}

function build() {
  $('network').textContent = `${NETWORK.name} (chain ${ARC_CHAIN.id})`
  if (!CIRCLE_CLIENT_KEY) log('WARNING: VITE_CIRCLE_CLIENT_KEY is empty. Circle calls will fail.')
  const stored = readStoredPasskey()
  if (stored) $('status-passkey').textContent = `${stored.account} (saved in this tab: click Use an existing passkey)`

  let row = section('Passkey', 'G5, G6 and G7 run on a test passkey account. Create one (named gate0-<time>), or use an existing one. After a reload, Use an existing passkey asks for the one this tab used.')
  button(row, 'Create a new test passkey', () => setPasskey('Register'))
  button(row, 'Use an existing passkey', () => setPasskey('Login'))

  row = section('G1 Email', 'Open the email login, sign in with the code, then run G1. Record which open button worked.')
  button(row, "Open view 'EmailLogin'", openView('EmailLogin'))
  button(row, "Open view 'Connect'", openView('Connect'))
  button(row, 'Run G1 checks', async () => eoaChecks('G1', await appKitOwner(), true, accountInfo()))

  row = section('G2 Google', 'Sign out first (G3 Disconnect). Open the Google flow, sign in, then run G2. Note the popup behaviour in Notes.')
  button(row, "Open view 'ConnectSocials'", openView('ConnectSocials'))
  button(row, "Open view 'Connect'", openView('Connect'))
  button(row, 'Run G2 checks', async () => eoaChecks('G2', await appKitOwner(), true, accountInfo()))

  row = section('G3 Reload and sign out', 'G3_load is recorded on every load. After a reload with an email session, Sign again. Then Disconnect and reload.')
  button(row, 'Sign again (no new code)', async () => eoaChecks('G3_signAgain', await appKitOwner(), false, accountInfo()))
  button(row, 'Disconnect', async () => {
    await appKit.disconnect()
    results.G3_disconnect = sanitize({ at: now(), after: accountInfo().account })
    render()
    log('disconnected')
  })
  button(row, 'Reload page', async () => window.location.reload())

  row = section('G4 Wallets', 'MetaMask through EIP-6963, without AppKit, sends a stand-in operation. Then a mobile wallet through the AppKit QR signs once.')
  button(row, 'MetaMask (EIP-6963): run', g4Extension)
  button(row, "Open view 'ConnectWallets' (QR)", openView('ConnectWallets'))
  button(row, 'Mobile wallet: sign once', async () => eoaChecks('G4_mobile', await appKitOwner(), false, accountInfo()))

  row = section('G5 Mapping and G7 Remove (scripted)', 'Uses the test passkey account and throwaway EOAs made in memory. Runs M4, M2, G8 rows, then removeOwners by the passkey, the last-owner revert, and an EOA removing itself.')
  button(row, 'Run G5 (M2, M4) and G7', scripted)

  row = section('G6 Add flows', 'Sign in with email first (G1). a: the passkey adds the email EOA (M1). b: the email EOA adds a new passkey (M3).')
  button(row, 'G6a registerRecoveryAddress', g6Register)
  button(row, 'G6b executeRecovery', g6Recover)

  row = section('G8 Owner rows', 'Read ownershipInfoOf for any account. The scripted run also records a passkey row and an EOA row.')
  const input = document.createElement('input')
  input.placeholder = '0x account address'
  input.size = 44
  row.append(input)
  button(row, 'Read owners', async () => {
    const c = check(`G8_read`)
    await c.step('owners', () => owners(input.value.trim() as Address))
    c.done()
  })

  row = section('G9 CSP', 'After the email and Google flows, collect the hosts this page loaded and what the app CSP would block. Also save the DevTools network log.')
  button(row, 'Collect CSP hosts', async () => g9())

  row = section('G10 Errors', 'Pick a case, Start, do it, then Finish. Errors, AppKit events and console errors in between are saved under that case.')
  const select = document.createElement('select')
  for (const name of ['wrongCode', 'closedModal', 'blockedGooglePopup', 'reownBlocked', 'offlineSign']) {
    const o = document.createElement('option')
    o.value = o.textContent = name
    select.append(o)
  }
  row.append(select)
  button(row, 'Start case', async () => {
    caseMark = { name: select.value, index: captured.length }
    log(`G10 case ${select.value} started`)
  })
  button(row, 'Sign a raw hash now', signOnce)
  button(row, 'Finish case', async () => {
    if (!caseMark) return
    const g10 = (results.G10 ??= {}) as Record<string, unknown>
    g10[caseMark.name] = sanitize(captured.slice(caseMark.index))
    log(`G10 case ${caseMark.name} saved`)
    caseMark = null
    render()
  })

  $('copy').addEventListener('click', async () => {
    const text = toJson({ page: 'fundit gate0', network: NETWORK.name, copiedAt: now(), notes: ($('notes') as HTMLTextAreaElement).value, results, log: logLines })
    try {
      await navigator.clipboard.writeText(text)
      log('copied all results')
    } catch {
      const t = $('notes') as HTMLTextAreaElement
      const keep = t.value
      t.value = text
      t.select()
      document.execCommand('copy')
      t.value = keep
      log('copied all results (fallback)')
    }
  })
  render()
  log(`page loaded on ${window.location.origin}`)
}

build()
