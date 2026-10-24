import { connect, type Connector, disconnect, getAccount, getConnectors, switchChain, watchConnectors } from '@wagmi/core'
import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { ARC_CHAIN_ID, REOWN_PROJECT_ID } from '../config'
import { CANCELLED, explainError, isUserRejection } from '../lib/errors'
import { qrMatrix, qrPath } from '../lib/qr'
import { wagmiConfig } from '../wagmi'
import { Button } from './ui'
import './SignInOptions.css'

// Fundit's own wallet list, used by sign-in and the From another chain tab. Importing it loads wagmi, so both load it
// with import() only once the person asks to connect a wallet.

const SWITCH_REFUSED = 'Your wallet did not switch to the Arc network. Connect again and approve the switch.'
const PHONE = 'walletConnect'

// Wallets the browser announces (EIP-6963) carry their own name and icon. With none announced, a browser that
// still has a wallet gets the plain injected one.
function browserWallets(all: readonly Connector[]): Connector[] {
  const announced = all.filter((c) => c.type === 'injected' && c.id !== 'injected')
  if (announced.length > 0) return announced
  const hasWallet = typeof window !== 'undefined' && 'ethereum' in window
  return hasWallet ? all.filter((c) => c.id === 'injected') : []
}

function PhoneQr({ uri }: { uri: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null)
  useEffect(() => {
    let live = true
    qrMatrix(uri).then(
      (m) => live && setQr({ size: m.size + 8, path: qrPath(m) }),
      () => live && setQr(null),
    )
    return () => {
      live = false
    }
  }, [uri])
  if (!qr) return <div className="connect-qr connect-qr-loading" aria-hidden="true" />
  return (
    <svg className="connect-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code to connect a phone wallet">
      {/* Fixed dark on white, whatever the theme: QR scanners need that contrast. */}
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#101928" />
    </svg>
  )
}

// Connects the chosen wallet, switches it to Arc (the wallet adds the network if it needs to), then hands back
// the address and the connector id. A refused switch disconnects again, so nothing half-connected stays behind.
export function ConnectWallet({ onConnected }: { onConnected: (address: Address, connectorId: string) => void }) {
  const [connectors, setConnectors] = useState(() => getConnectors(wagmiConfig))
  useEffect(() => watchConnectors(wagmiConfig, { onChange: setConnectors }), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const inFlight = useRef(false)

  const wallets = browserWallets(connectors)
  const phone = REOWN_PROJECT_ID !== '' ? connectors.find((c) => c.id === PHONE) : undefined

  async function use(connector: Connector) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(connector.id)
    setError(null)
    // WalletConnect hands its pairing link over as a display_uri message. The QR code is drawn from it.
    const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
      if (type === 'display_uri' && typeof data === 'string') setUri(data)
    }
    if (connector.id === PHONE) connector.emitter.on('message', onMessage)
    try {
      const current = getAccount(wagmiConfig)
      const address =
        current.connector?.uid === connector.uid && current.address
          ? current.address
          : (await connect(wagmiConfig, { connector })).accounts[0]
      if (!address) throw new Error('The wallet returned no account.')
      try {
        await switchChain(wagmiConfig, { chainId: ARC_CHAIN_ID })
      } catch (err) {
        await disconnect(wagmiConfig, { connector }).catch(() => {})
        setError(isUserRejection(err) ? SWITCH_REFUSED : explainError(err))
        return
      }
      onConnected(address, connector.id)
    } catch (err) {
      setError(isUserRejection(err) ? CANCELLED : explainError(err))
    } finally {
      if (connector.id === PHONE) connector.emitter.off('message', onMessage)
      inFlight.current = false
      setBusy(null)
      setUri(null)
    }
  }

  return (
    <div className="connect-wallet">
      {wallets.length === 0 && !phone && <p className="connect-note">No wallet found in this browser.</p>}
      {wallets.length > 0 && (
        <ul className="connect-list" aria-label="Wallets in this browser">
          {wallets.map((c) => (
            <li key={c.uid}>
              <Button variant="secondary" size="lg" block disabled={busy !== null} loading={busy === c.id} onClick={() => void use(c)}>
                {c.icon && <img className="connect-icon" src={c.icon} alt="" width={24} height={24} />}
                {c.id === 'injected' ? 'Browser wallet' : c.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {phone && (
        <Button variant="secondary" size="lg" block disabled={busy !== null} loading={busy === PHONE} onClick={() => void use(phone)}>
          Phone wallet (QR code)
        </Button>
      )}
      {busy === PHONE && uri && (
        <div className="connect-phone">
          <PhoneQr uri={uri} />
          <p className="connect-note">Scan this with your phone wallet, then approve the connection there.</p>
        </div>
      )}
      {busy !== null && busy !== PHONE && <p className="connect-note">Approve the connection in your wallet.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
