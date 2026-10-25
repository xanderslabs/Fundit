// Share links for a Fundit. Every value from a title or URL is passed through encodeURIComponent, because the
// title is written by anyone and may hold spaces, "&", "#", line breaks or emoji.

// name is the button text; label is the accessible name.
export type ShareTarget = { key: string; name: string; label: string; href: string }

// The canonical page of a Fundit, with no tracking parameters.
export function funditUrl(origin: string, address: string): string {
  return `${origin}/c/${address}`
}

// The sentence without the link, for services that take the link in its own field.
export function shareText(title: string, isCreator: boolean): string {
  // The title is quoted, so it reads right whatever its first word is ("Help Help build..." before).
  return isCreator ? `I started a Fundit: "${title}". Every gift helps` : `Give to "${title}" on Fundit`
}

export function shareMessage(title: string, url: string, isCreator: boolean): string {
  return `${shareText(title, isCreator)}: ${url}`
}

export function shareTargets(title: string, url: string, isCreator: boolean): ShareTarget[] {
  const e = encodeURIComponent
  const text = shareText(title, isCreator)
  const message = shareMessage(title, url, isCreator)
  return [
    { key: 'x', name: 'X', label: 'Share on X', href: `https://x.com/intent/post?text=${e(message)}` },
    { key: 'whatsapp', name: 'WhatsApp', label: 'Share on WhatsApp', href: `https://wa.me/?text=${e(message)}` },
    { key: 'telegram', name: 'Telegram', label: 'Share on Telegram', href: `https://t.me/share/url?url=${e(url)}&text=${e(text)}` },
    { key: 'facebook', name: 'Facebook', label: 'Share on Facebook', href: `https://facebook.com/sharer/sharer.php?u=${e(url)}` },
    { key: 'linkedin', name: 'LinkedIn', label: 'Share on LinkedIn', href: `https://linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { key: 'reddit', name: 'Reddit', label: 'Share on Reddit', href: `https://reddit.com/submit?url=${e(url)}&title=${e(text)}` },
    { key: 'email', name: 'Email', label: 'Share by email', href: `mailto:?subject=${e(text)}&body=${e(message)}` },
    // "sms:?&body=" works on both iOS and Android, which disagree on the separator before body.
    { key: 'sms', name: 'SMS', label: 'Share by text message', href: `sms:?&body=${e(message)}` },
  ]
}

// The title goes into an HTML attribute on someone else's site, so every character that could end the
// attribute or start markup is escaped.
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function embedUrl(origin: string, address: string): string {
  return `${origin}/embed/c/${address}`
}

export function embedSnippet(origin: string, address: string, title: string): string {
  return `<iframe src="${embedUrl(origin, address)}" width="360" height="220" style="border:0;border-radius:16px" title="${escapeAttr(`${title} on Fundit`)}" loading="lazy"></iframe>`
}
