import { type Address, isAddress, isAddressEqual, zeroAddress } from 'viem'
import { TOKENS, type TokenSymbol } from '../config'
import { parseAmount } from './format'
import { safeHttpsUrl } from './urls'

// Limits from contracts/src/MetadataLib.sol. All are UTF-8 bytes, as the contract counts them.
export const MAX_TITLE = 100
export const MAX_DESCRIPTION = 5000
export const MAX_IMAGE_URL = 500
export const MAX_LINKS = 5
export const MAX_LINK = 200
const MIN_URL = 'https://'.length

export type Metadata = { title: string; description: string; imageUrl: string; links: string[] }

export type CampaignInput = {
  title: string
  description: string
  imageUrl: string
  links: string[]
  goal: string
  token: TokenSymbol
  backup: string
  // The connected address. createCampaign reverts InvalidBackup when the backup equals it.
  sender: Address | undefined
}

export type CampaignResult =
  | { ok: true; meta: Metadata; goal: bigint; token: Address; backup: Address }
  | { ok: false; errors: Record<string, string> }

const encoder = new TextEncoder()

export function byteLength(s: string): number {
  return encoder.encode(s).length
}

// The contract only checks the prefix. Also requiring a parseable URL keeps out links the app would not render.
function checkUrl(url: string, max: number): string | null {
  const bytes = byteLength(url)
  if (bytes < MIN_URL || !url.startsWith('https://')) return 'Use a full link that starts with https://'
  if (bytes > max) return `Keep it to ${max} bytes. This one is ${bytes}.`
  if (safeHttpsUrl(url) === null) return 'This link is not valid. Check it for typos.'
  return null
}

// Mirrors MetadataLib.validate and the createCampaign checks, so a valid form never reverts on them.
// URLs and the title are trimmed first. That is never looser than the contract.
export function validateCampaign(input: CampaignInput): CampaignResult {
  const errors: Record<string, string> = {}

  const title = input.title.trim()
  const titleBytes = byteLength(title)
  if (titleBytes === 0) errors.title = 'Enter a title.'
  else if (titleBytes > MAX_TITLE) errors.title = `Keep the title to ${MAX_TITLE} bytes. It is ${titleBytes}.`

  const description = input.description
  const descriptionBytes = byteLength(description)
  if (descriptionBytes > MAX_DESCRIPTION) {
    errors.description = `Keep the description to ${MAX_DESCRIPTION} bytes. It is ${descriptionBytes}.`
  }

  const imageUrl = input.imageUrl.trim()
  if (imageUrl !== '') {
    const err = checkUrl(imageUrl, MAX_IMAGE_URL)
    if (err) errors.imageUrl = err
  }

  // Blank rows are dropped first. Errors keep the row index so the form can show them on the right row.
  const rows = input.links.map((l, i) => ({ url: l.trim(), i })).filter((r) => r.url !== '')
  if (rows.length > MAX_LINKS) errors.links = `Add at most ${MAX_LINKS} links.`
  for (const { url, i } of rows) {
    const err = checkUrl(url, MAX_LINK)
    if (err) errors[`link-${i}`] = err
  }

  const goal = parseAmount(input.goal.trim())
  if (!goal.ok) errors.goal = goal.error

  let backup: Address = zeroAddress
  const rawBackup = input.backup.trim()
  if (rawBackup !== '') {
    if (!isAddress(rawBackup, { strict: false })) {
      errors.backup = 'Enter a valid address (0x and 40 characters), or leave it empty.'
    } else if (input.sender && isAddressEqual(rawBackup, input.sender)) {
      errors.backup = 'Use a different address from the wallet you are connected with.'
    } else {
      backup = rawBackup
    }
  }

  if (Object.keys(errors).length > 0 || !goal.ok) return { ok: false, errors }
  return {
    ok: true,
    meta: { title, description, imageUrl, links: rows.map((r) => r.url) },
    goal: goal.value,
    token: TOKENS[input.token].address,
    backup,
  }
}
