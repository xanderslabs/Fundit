// Keys that wagmi and AppKit write to localStorage once a wallet has connected in Add money.
const REMEMBERED_WALLET_KEYS = ['wagmi.recentConnectorId', '@appkit/connections']

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

// Sign out drops a wallet connected to add money, so the next person on this browser does not get it back in
// Add money. The wallet code loads only if this browser has connected a wallet before. With none, this does
// nothing. It never throws: sign out goes ahead whatever happens here.
export function disconnectWallet(): void {
  if (!rememberedWallet()) return
  void import('../wagmi')
    .then((m) => m.disconnectWallet())
    // wagmi keeps its recent connector after a disconnect. Forget it, or every later sign-out loads AppKit again.
    .then(forgetWallet)
    .catch(() => {})
}
