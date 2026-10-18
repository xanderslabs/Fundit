import { useAppKit } from '@reown/appkit/react'
import { useQuery } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, type EIP1193Provider, formatUnits } from 'viem'
import { useConnection } from 'wagmi'
import { erc20Abi } from '../abi/erc20'
import { PasskeyLogin } from '../components/PasskeyLogin'
import { PendingBridgeTracker } from '../components/CrossChainDonate'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey, CROSSCHAIN_ENABLED, TOKENS } from '../config'
import { chainByKey, donateCrossChain, estimateCrossChain } from '../lib/bridge'
import { arcClient } from '../lib/clients'
import { explainAfterApproval } from '../lib/errors'
import { formatAmount, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { usePasskeySession } from '../lib/passkey'

const BALANCE_POLL_MS = 15_000
const QUOTE_DEBOUNCE_MS = 400

// A QR code for the address, drawn as SVG squares so no HTML string is injected.
function AddressQr({ address }: { address: Address }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(address)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { size: n + 8, path: d }
  }, [address])
  return (
    <svg className="fund-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code of your wallet address">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#101928" />
    </svg>
  )
}

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="fund-address">
      <code>{address}</code>
      <button type="button" className="btn btn-outline" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy address'}
      </button>
      {copied === false && <p className="field-error">Could not copy. Select the address and copy it yourself.</p>}
    </div>
  )
}

// Bridge Kit from an external wallet on another chain. Circle's forwarder mints the USDC to the passkey wallet on Arc.
function BridgeToPasskey({ recipient }: { recipient: Address }) {
  const { open } = useAppKit()
  const { isConnected, address, connector } = useConnection()
  const wallet = isConnected && connector ? connector : null
  const [sourceKey, setSourceKey] = useState<CctpChainKey>('Base')
  const [fastChoice, setFastChoice] = useState(true)
  const [amountText, setAmountText] = useState('')
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })
  const inFlight = useRef(false)

  const chain = chainByKey(sourceKey)
  const fast = fastChoice && chain.fast
  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null

  const [quoteAmount, setQuoteAmount] = useState<bigint | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuoteAmount(amount), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [amount])

  const fee = useQuery({
    queryKey: ['fund-fee', sourceKey, fast, quoteAmount?.toString(), wallet ? address : null],
    queryFn: async (): Promise<bigint> => {
      const circle = async () => (await fetchForwardFee(chain.domain, ARC_DOMAIN, quoteAmount!, fast)).maxFee
      if (!wallet) return circle()
      try {
        const provider = (await wallet.getProvider()) as EIP1193Provider
        return await estimateCrossChain({ provider, sourceKey, campaign: recipient, amount: formatUnits(quoteAmount!, 6), fast, account: address })
      } catch {
        return circle()
      }
    },
    enabled: quoteAmount !== null,
    staleTime: 30_000,
    retry: 1,
  })
  const quote = amount !== null && quoteAmount === amount ? fee.data : undefined
  const arrives = amount !== null && quote !== undefined ? amount - quote : null
  const tooSmall = arrives !== null && arrives <= 0n
  const busy = phase.kind === 'sending'
  const canSubmit = wallet !== null && amount !== null && arrives !== null && !tooSmall && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current || !canSubmit || !wallet || amount === null) return
    inFlight.current = true
    setPhase({ kind: 'sending' })
    try {
      const provider = (await wallet.getProvider()) as EIP1193Provider
      // donateCrossChain only bridges: the forwarder mints straight to the recipient, here the passkey wallet.
      await donateCrossChain({ provider, sourceKey, campaign: recipient, amount: formatUnits(amount, 6), fast, account: address })
      setAmountText('')
      setPhase({ kind: 'sent' })
    } catch (err) {
      setPhase({ kind: 'error', message: explainAfterApproval(err) })
    } finally {
      inFlight.current = false
    }
  }

  return (
    <form className="donate-form" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="donate-fields" disabled={busy}>
        <div className="form-field">
          <label htmlFor="fund-source">From</label>
          <select id="fund-source" className="select" value={sourceKey} onChange={(e) => setSourceKey(e.target.value as CctpChainKey)}>
            {CCTP_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {CHAIN_LABELS[c.key]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="fund-amount">Amount</label>
          <div className="donate-amount">
            <input
              id="fund-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="25"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={parsed && !parsed.ok ? true : undefined}
            />
            <span className="donate-symbol">USDC</span>
          </div>
          {parsed && !parsed.ok && (
            <p className="field-error" role="alert">
              {parsed.error}
            </p>
          )}
        </div>
        <fieldset className="form-field">
          <legend>Speed</legend>
          <div className="donate-options">
            {chain.fast && (
              <label className="donate-option">
                <input type="radio" name="fund-speed" checked={fast} onChange={() => setFastChoice(true)} />
                <span>Fast</span>
              </label>
            )}
            <label className="donate-option">
              <input type="radio" name="fund-speed" checked={!fast} onChange={() => setFastChoice(false)} />
              <span>Standard</span>
            </label>
          </div>
        </fieldset>
      </fieldset>

      {amount !== null && (
        <dl className="donate-breakdown" aria-label="Breakdown">
          <div>
            <dt>Transfer fees</dt>
            <dd>{quote !== undefined ? formatAmount(quote, 'USDC') : fee.isError ? 'Not available' : 'Checking...'}</dd>
          </div>
          <div className="donate-total">
            <dt>Arrives in your passkey wallet</dt>
            <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, 'USDC')}` : '-'}</dd>
          </div>
        </dl>
      )}
      {fee.isError && <p className="field-error">Could not get a fee quote. Try again in a moment.</p>}
      {tooSmall && <p className="field-error">This amount does not cover the transfer fees. Try a larger amount.</p>}
      <p className="hint">The transfer fees come out of the amount. You also pay network gas on {CHAIN_LABELS[sourceKey]}.</p>

      <div className="donate-status" aria-live="polite">
        {busy && <p>Confirm in your wallet. It may ask you to switch network and approve USDC first.</p>}
        {phase.kind === 'sent' && (
          <div className="status-box status-success">
            <p>
              <strong>Your USDC is on its way.</strong> Follow it below.
            </p>
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="status-box status-error">
            <p>{phase.message}</p>
          </div>
        )}
      </div>

      {wallet ? (
        <button type="submit" className="btn" disabled={!canSubmit}>
          {busy ? 'Sending...' : 'Bridge USDC'}
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => open()}>
          Connect the wallet that holds the USDC
        </button>
      )}
    </form>
  )
}

export function FundWallet() {
  const session = usePasskeySession()
  const address = session?.address

  const balance = useQuery({
    queryKey: ['usdc-balance', address?.toLowerCase()],
    queryFn: () => arcClient.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address!] }),
    enabled: address !== undefined,
    refetchInterval: BALANCE_POLL_MS,
  })

  if (!address) {
    return (
      <section className="notice">
        <h1>Your passkey wallet</h1>
        <PasskeyLogin />
      </section>
    )
  }

  return (
    <section className="manage">
      <header className="page-head">
        <h1>Your passkey wallet</h1>
        <p className="muted">This wallet lives on Arc. Add USDC here, then give from it with your passkey.</p>
      </header>

      <section className="panel manage-section" aria-labelledby="fund-address-heading">
        <h2 id="fund-address-heading">Your address on Arc</h2>
        <p>
          Balance:{' '}
          <strong>
            {balance.data !== undefined ? formatAmount(balance.data, 'USDC') : balance.isError ? 'Could not read it' : 'Loading...'}
          </strong>
        </p>
        <p className="hint">Network fees on Arc are paid in USDC from this balance, so keep a little extra.</p>
        <CopyAddress address={address} />
        <AddressQr address={address} />
        <p className="hint">Send only USDC on Arc to this address. It is not the same wallet on other chains.</p>
      </section>

      {CROSSCHAIN_ENABLED ? (
        <section className="panel manage-section" aria-labelledby="fund-bridge-heading">
          <h2 id="fund-bridge-heading">Bridge USDC from another chain</h2>
          <p className="hint">Move USDC from a wallet on another chain. Circle delivers it to your passkey wallet on Arc.</p>
          <BridgeToPasskey recipient={address} />
          <PendingBridgeTracker campaign={address} destination="your passkey wallet" />
        </section>
      ) : (
        // A bridge started while the option was on may still arrive, so it stays tracked.
        <PendingBridgeTracker campaign={address} destination="your passkey wallet" />
      )}
    </section>
  )
}
