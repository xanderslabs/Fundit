import { lazy, Suspense, useState } from 'react'
import type { Address } from 'viem'
import { CROSSCHAIN_ENABLED } from '../config'
import { useAccount } from '../lib/account'
import { AddressQr } from './AddressTools'
import { ErrorBoundary } from './ErrorBoundary'
import { AddressChip, ContentTabs } from './ui'
import './AddMoneyPanel.css'
import './Form.css'

// The wallet tabs load wagmi, so they load only when one first opens (see WalletTabs.tsx).
const loadWalletTabs = () => import('./WalletTabs')
const WalletDeposit = lazy(() => loadWalletTabs().then((m) => ({ default: m.WalletDeposit })))
const BridgeToAccount = lazy(() => loadWalletTabs().then((m) => ({ default: m.BridgeToAccount })))
const LOADING = <p className="form-hint">Loading...</p>

// The Add money panel on My page: the account's own address, a connected wallet on Arc and, when switched on,
// a bridge from another chain. Each way is a tab. Visited tabs stay mounted, so a send in flight keeps its state.
export function AddMoneyPanel({ account }: { account: Address }) {
  // True while a transfer from another chain is being signed in the shared wallet connection.
  const [bridging, setBridging] = useState(false)
  // A wallet account is the wallet, so there is no other wallet to add money from.
  const isWalletAccount = useAccount()?.kind === 'wallet'
  const tabs = [
    {
      id: 'address',
      label: 'Your address',
      content: (
        <div className="deposit-tab">
          <p>Send USDC or EURC on Arc to this address from any wallet or exchange.</p>
          <div className="deposit-address">
            <AddressQr address={account} label="QR code of your Fundit account address" />
            <AddressChip address={account} full />
          </div>
          <p className="form-hint">This address is on Arc only. Money sent to it on another chain will not arrive.</p>
        </div>
      ),
    },
    ...(isWalletAccount
      ? []
      : [
          {
            id: 'wallet',
            label: 'From a wallet',
            content: (
              <div className="deposit-tab">
                <p className="form-hint">Send USDC or EURC from a regular wallet on Arc.</p>
                <ErrorBoundary>
                  <Suspense fallback={LOADING}>
                    <WalletDeposit account={account} bridging={bridging} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ),
          },
        ]),
    ...(CROSSCHAIN_ENABLED
      ? [
          {
            id: 'chain',
            label: 'From another chain',
            content: (
              <div className="deposit-tab">
                <p className="form-hint">Move USDC from a wallet on another chain. Circle delivers it to your Fundit account on Arc.</p>
                <ErrorBoundary>
                  <Suspense fallback={LOADING}>
                    <BridgeToAccount recipient={account} onBusyChange={setBridging} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ),
          },
        ]
      : []),
  ]
  return (
    <>
      <ContentTabs label="Ways to add money" tabs={tabs} keepMounted className="deposit-tabs" />
      <p className="form-hint">Card and bank coming soon.</p>
    </>
  )
}
