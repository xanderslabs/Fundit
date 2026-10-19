// The one passkey account the e2e suite reuses, so Circle's count of active wallets stays low. The file is made
// once by `npm run e2e:make-account` and is gitignored (.env.*). Nothing here prints a value from it, and no
// error message includes one.

export const PASSKEY_FILE = '.env.testnet.passkey'

export type SharedPasskey = {
  // Base64, as the Chrome DevTools WebAuthn domain gives and takes them.
  credentialId: string
  privateKey: string
  userHandle: string
  // The site the passkey belongs to: fundit.fun.
  rpId: string
  account: `0x${string}`
  username: string
}

const KEYS: Record<keyof SharedPasskey, string> = {
  credentialId: 'E2E_PASSKEY_CREDENTIAL_ID',
  privateKey: 'E2E_PASSKEY_PRIVATE_KEY',
  userHandle: 'E2E_PASSKEY_USER_HANDLE',
  rpId: 'E2E_PASSKEY_RP_ID',
  account: 'E2E_ACCOUNT_ADDRESS',
  username: 'E2E_ACCOUNT_USERNAME',
}

const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/

export function serializeSharedPasskey(p: SharedPasskey): string {
  const lines = (Object.keys(KEYS) as (keyof SharedPasskey)[]).map((k) => `${KEYS[k]}=${p[k]}`)
  return `# The shared e2e passkey account. Secret: never commit, print or share this file.\n${lines.join('\n')}\n`
}

export function parseSharedPasskey(text: string): SharedPasskey {
  const values = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const get = (k: keyof SharedPasskey) => {
    const v = values.get(KEYS[k])
    if (!v) throw new Error(`app/${PASSKEY_FILE} has no ${KEYS[k]} line.`)
    return v
  }
  const p: SharedPasskey = {
    credentialId: get('credentialId'),
    privateKey: get('privateKey'),
    userHandle: get('userHandle'),
    rpId: get('rpId'),
    account: get('account') as `0x${string}`,
    username: get('username'),
  }
  for (const k of ['credentialId', 'privateKey', 'userHandle'] as const) {
    if (!BASE64.test(p[k])) throw new Error(`${KEYS[k]} in app/${PASSKEY_FILE} is not base64.`)
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.account)) throw new Error(`E2E_ACCOUNT_ADDRESS in app/${PASSKEY_FILE} is not an address.`)
  return p
}

// A passkey works only on its own site (the rpId). Local e2e no longer works: the testnet client key's passkey
// domain is fundit.fun, so a localhost page cannot use this passkey.
export function checkRpId(p: SharedPasskey, baseUrl: string) {
  const host = new URL(baseUrl).hostname
  if (host === p.rpId) return
  throw new Error(
    `The shared e2e passkey is bound to ${p.rpId}, but the suite is opening ${host}. Run it with E2E_BASE_URL=https://${p.rpId}. ` +
      'Local e2e runs cannot use passkeys any more: see e2e/README.md.',
  )
}

// The account keeps its money between runs. The funder sends only what this run is missing.
export function topUpFor(balance: bigint, budget: bigint): bigint {
  return balance >= budget ? 0n : budget - balance
}

// The stored passkey goes into a fresh virtual authenticator each run, so its signature counter starts from
// here. Seconds since 1970 keep it rising from run to run, as WebAuthn expects, and fit its 32 bits until 2106.
export function signCountNow(): number {
  return Math.floor(Date.now() / 1000)
}
