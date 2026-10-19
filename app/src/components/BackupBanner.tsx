import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { encodeFunctionData, isAddressEqual, zeroAddress } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { useSender } from '../hooks/useSender'
import type { CampaignView } from '../lib/campaigns'
import { TxStatus, useTx } from './TxStatus'
import { Banner, Button } from './ui'
import './BackupBanner.css'

const MINUTE_MS = 60_000

// "2 days 3 hours" or "4 hours 10 minutes". Rounded down, so it never promises an earlier time.
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days > 0) return `${part(days, 'day')} ${part(hours, 'hour')}`
  if (hours > 0) return `${part(hours, 'hour')} ${part(minutes, 'minute')}`
  return part(Math.max(1, minutes), 'minute')
}

// Shown on the campaign page to the campaign's backup address only.
export function BackupBanner({ view }: { view: CampaignView }) {
  const { address: campaign, summary } = view
  const sender = useSender()
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const tx = useTx(() => {
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
    void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
  })

  const isBackup = sender !== null && summary.backup !== zeroAddress && isAddressEqual(sender.address, summary.backup)
  const readyAtMs = Number(summary.recoveryReadyAt) * 1000
  const pending = summary.recoveryReadyAt !== 0n
  const waiting = pending && now < readyAtMs

  // Ticks once a minute while the countdown shows, so the button appears when the wait is over.
  useEffect(() => {
    if (!isBackup || !waiting) return
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [isBackup, waiting])

  if (!isBackup || !sender) return null

  const send = (functionName: 'initiateRecovery' | 'completeRecovery', label: string) =>
    tx.run(sender, () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName }) }), label)

  const action = !pending ? (
    <Button disabled={tx.locked} onClick={() => send('initiateRecovery', 'Start recovery')}>
      Start recovery
    </Button>
  ) : !waiting ? (
    <Button disabled={tx.locked} onClick={() => send('completeRecovery', 'Complete recovery')}>
      Complete recovery
    </Button>
  ) : undefined

  return (
    <section className="backup-banner" aria-label="Backup recovery">
      <Banner tone="attention" action={action}>
        <div className="backup-banner-body">
          <h2 className="backup-banner-title">You are the backup for this Fundit</h2>
          {!pending && (
            <p>
              If the organiser has lost their wallet, you can start a recovery. After a 7-day wait you can become the
              organiser. The organiser can cancel during those 7 days.
            </p>
          )}
          {waiting && (
            <p>
              Recovery has started. You can complete it in {formatWait((readyAtMs - now) / 1000)}, on{' '}
              {new Date(readyAtMs).toLocaleString()}.
            </p>
          )}
          {pending && !waiting && <p>The 7-day wait is over. Complete the recovery to become the organiser.</p>}
          <TxStatus
            tx={tx}
            noun="transaction"
            successText="Done. The page will update in a moment."
            startOverWarning="The earlier transaction may still go through. Try again anyway?"
          />
        </div>
      </Banner>
    </section>
  )
}
