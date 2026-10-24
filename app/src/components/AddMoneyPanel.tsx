import { lazy, Suspense } from 'react'
import type { Address } from 'viem'
import { CROSSCHAIN_ENABLED } from '../config'
import { AddressQr } from './AddressTools'
import { ErrorBoundary } from './ErrorBoundary'
import { AddressChip, ContentTabs } from './ui'
import './AddMoneyPanel.css'
import './Form.css'

// The bridge tab loads wagmi, so it loads only when it first opens (see WalletTabs.tsx).
const BridgeToAccount = lazy(() => import('./WalletTabs').then((m) => ({ default: m.BridgeToAccount })))
const LOADING = <p className="form-hint">Loading...</p>

// The Add money panel on My page: the account's own address and, when switched on, a bridge from another chain.
// With the bridge off there is one way in, so it shows without a tab strip. With it on, each way is a tab and
// visited tabs stay mounted, so a transfer in flight keeps its state.
export function AddMoneyPanel({ account }: { account: Address }) {
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
                    <BridgeToAccount recipient={account} />
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
      {tabs.length === 1 ? (
        tabs[0]!.content
      ) : (
        <ContentTabs label="Ways to add money" tabs={tabs} keepMounted className="deposit-tabs" />
      )}
      <p className="form-hint">Card and bank coming soon.</p>
    </>
  )
}
