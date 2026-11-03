import type { Address } from 'viem'
import { AddressQr } from './AddressTools'
import { AddressChip } from './ui'
import './AddMoneyPanel.css'
import './Form.css'

// The Add money panel on My page: the account's own address on Arc.
export function AddMoneyPanel({ account }: { account: Address }) {
  return (
    <>
      <div className="deposit-tab">
        <p>Send USDC or EURC on Arc to this address from any wallet or exchange.</p>
        <div className="deposit-address">
          <AddressQr address={account} label="QR code of your Fundit account address" />
          <AddressChip address={account} full />
        </div>
        <p className="form-hint">This address is on Arc only. Money sent to it on another chain will not arrive.</p>
      </div>
      <p className="form-hint">Card and bank coming soon.</p>
    </>
  )
}
