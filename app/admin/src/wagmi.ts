// The admin panel's own wallet setup: Arc only, with the same wallet list as Fundit (a browser wallet, or a phone
// through WalletConnect, which ConnectWallet draws the QR code for).
import { createConfig, injected } from '@wagmi/core'
import { walletConnect } from 'wagmi/connectors/walletConnect'
import { http } from 'viem'
import { ARC_CHAIN, ARC_RPC_URL, REOWN_PROJECT_ID } from '../../src/config'

export const adminWagmiConfig = createConfig({
  chains: [ARC_CHAIN],
  transports: { [ARC_CHAIN.id]: http(ARC_RPC_URL) },
  connectors: [injected(), walletConnect({ projectId: REOWN_PROJECT_ID, showQrModal: false })],
})
