// Keys wagmi writes to localStorage once a wallet has connected (wallet sign-in or the bridge tab).
const REMEMBERED_WALLET_KEYS = ['wagmi.recentConnectorId', 'wagmi.store']

function forgetWallet() {
  try {
    for (const key of REMEMBERED_WALLET_KEYS) localStorage.removeItem(key)
  } catch {
    // Storage is unavailable. Nothing was remembered, then.
  }
}

function rememberedWallet(): boolean {
  try {
    return REMEMBERED_WALLET_KEYS.some((key) => localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

// Sign out drops a connected wallet (a wallet sign-in), so the next person on this browser does not inherit it.
// The wallet code loads only if this browser has connected a wallet before. With none, this does
// nothing. It never throws: sign out goes ahead whatever happens here.
export function disconnectWallet(): void {
  if (!rememberedWallet()) return
  void import('../wagmi')
    .then((m) => m.disconnectWallet())
    // wagmi keeps its recent connector after a disconnect. Forget it, or every later sign-out loads the wallet code again.
    .then(forgetWallet)
    .catch(() => {})
}
