// The donor notice is shown in full on the first gift from an account and on every gift to a Fundit under review.
// "Seen" lives in this browser only, per network and sending address. Raise the version when the notice text
// changes, so everyone sees it once more.
export const GIVE_NOTICE_VERSION = 1

const key = (network: string, sender: string) => `fundit:giveNotice:${network}:${sender.toLowerCase()}`

export function needsFullNotice(opts: { network: string; sender: string; moderation: 'normal' | 'review' }): boolean {
  if (opts.moderation === 'review') return true
  try {
    return localStorage.getItem(key(opts.network, opts.sender)) !== String(GIVE_NOTICE_VERSION)
  } catch {
    // Storage is blocked, so there is no proof the notice was seen.
    return true
  }
}

export function markNoticeSeen(network: string, sender: string): void {
  try {
    localStorage.setItem(key(network, sender), String(GIVE_NOTICE_VERSION))
  } catch {
    // Without storage the notice shows again next time.
  }
}
