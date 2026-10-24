// The wallet setup. Nothing imports this at start: Connect a wallet, a send from a wallet account and the Add
// money wallet tabs load it with import(). Creating the config does not reconnect a wallet from an earlier visit;
// a wallet account reconnects only when it sends (lib/walletAccount.ts).
import { createConfig, disconnect, injected } from '@wagmi/core'
import { walletConnect } from 'wagmi/connectors/walletConnect'
import { http } from 'viem'
import { ARC_CHAIN, ARC_RPC_URL, CCTP_CHAINS, REOWN_PROJECT_ID } from './config'

// Our public RPCs, Arc first, then the network's CCTP source chains.
const transports = {
  [ARC_CHAIN.id]: http(ARC_RPC_URL),
  ...Object.fromEntries(CCTP_CHAINS.map((c) => [c.chainId, http(c.rpcUrl)])),
}

// injected() is the browser wallet. Wallets that announce themselves (EIP-6963) join the list on their own.
// walletConnect shows no modal of its own: ConnectWallet draws the QR code from its display_uri message.
export const wagmiConfig = createConfig({
  chains: [ARC_CHAIN, ...CCTP_CHAINS.map((c) => c.viemChain)],
  transports,
  connectors: [injected(), walletConnect({ projectId: REOWN_PROJECT_ID, showQrModal: false })],
})

// For sign-out. Never throws: sign out goes ahead whatever happens here.
export async function disconnectWallet() {
  await disconnect(wagmiConfig).catch(() => {})
}
