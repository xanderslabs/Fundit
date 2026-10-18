// Everything the passkey wallet needs from Circle's SDK and viem's account abstraction, in one module that
// passkey.ts loads with import(). Named imports only: a dynamic import('viem') would pull all of viem
// into the first-load viem chunk.
export * as sdk from '@circle-fin/modular-wallets-core'
export { createPublicClient } from 'viem'
export { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction'
export { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
export { validateMnemonic } from '@scure/bip39'
export { wordlist as bip39English } from '@scure/bip39/wordlists/english'
