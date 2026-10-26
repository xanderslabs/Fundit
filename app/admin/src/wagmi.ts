// The admin panel's own wallet setup: both Arc networks, with the same wallet list as Fundit (a browser wallet, or a
// phone through WalletConnect, which ConnectWallet draws the QR code for).
import { createConfig, injected } from '@wagmi/core'
import { walletConnect } from 'wagmi/connectors/walletConnect'
import { http } from 'viem'
import { REOWN_PROJECT_ID } from '../../src/config'
import { ADMIN_NETWORKS } from './lib/networks'

const { mainnet, testnet } = ADMIN_NETWORKS

export const adminWagmiConfig = createConfig({
  chains: [mainnet.chain, testnet.chain],
  transports: { [mainnet.chainId]: http(mainnet.rpcUrl), [testnet.chainId]: http(testnet.rpcUrl) },
  connectors: [injected(), walletConnect({ projectId: REOWN_PROJECT_ID, showQrModal: false })],
})
