import type { Hex } from 'viem'
import type { FlowStep } from '../lib/controlFlow'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { ExternalLinkIcon } from './icons'

const WORDS: Partial<Record<FlowStep, string>> = {
  waitingWallet: 'Waiting for wallet',
  sent: 'Sent',
  confirmed: 'Confirmed',
  failed: 'Failed',
}

// The one transaction status for every owner change: what the wallet and the chain are doing, the explorer link
// once there is a hash (kept when waiting for the receipt fails), and the reason when it failed. Nothing for the
// steps before the wallet is asked.
export function TxStatus({ step, hash, network, error }: { step: FlowStep; hash?: Hex; network: AdminNetwork; error?: string }) {
  const word = WORDS[step]
  if (!word) return null
  const failed = step === 'failed'
  return (
    <div className={`admin-tx admin-tx-${step}`} role={failed ? 'alert' : 'status'}>
      <p className="admin-tx-head">
        {(step === 'waitingWallet' || step === 'sent') && <span className="ui-btn-spinner admin-tx-spinner" aria-hidden="true" />}
        <span className="admin-tx-word">{word}</span>
        {hash && (
          <a className="admin-tx-link" href={`${ADMIN_NETWORKS[network].explorerUrl}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
            View transaction
            <ExternalLinkIcon />
          </a>
        )}
      </p>
      {failed && error && <p className="admin-tx-error">{error}</p>}
    </div>
  )
}
