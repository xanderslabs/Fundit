// Sends one Telegram message. Used by the admin alerts and by the problem-report route.
// The token lives only in the URL. Nothing here logs, and no error text is passed on, because a fetch error can
// carry the URL.
const TIMEOUT_MS = 5_000

export async function sendTelegram(token: string, chatId: string, text: string, fetcher: typeof fetch = (i, n) => fetch(i, n)): Promise<boolean> {
  try {
    const res = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status !== 200) return false
    const body = (await res.json()) as { ok?: unknown }
    return body.ok === true
  } catch {
    return false
  }
}
