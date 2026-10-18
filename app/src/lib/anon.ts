import { MAX_MESSAGE_BYTES } from '../config'

// The contract has no donor privacy field, so the marker lives at the start of the message. It costs 6 bytes.
export const ANON_PREFIX = '[anon]'
const PREFIX_BYTES = 6

// A marker the donor typed is dropped first, so a ticked box and a typed "[anon]" still give one marker.
export function markAnonymous(message: string): string {
  return ANON_PREFIX + stripMarkers(message)
}

// A message that starts with the marker is anonymous, whether or not the box was ticked. The marker is the record.
// Every leading marker is stripped, so the literal "[anon]" never shows, even when it was typed more than once.
export function readMessage(raw: string): { anonymous: boolean; text: string } {
  return raw.startsWith(ANON_PREFIX) ? { anonymous: true, text: stripMarkers(raw) } : { anonymous: false, text: raw }
}

function stripMarkers(text: string): string {
  let rest = text
  while (rest.startsWith(ANON_PREFIX)) rest = rest.slice(ANON_PREFIX.length)
  return rest
}

export function messageLimit(anonymous: boolean): number {
  return anonymous ? MAX_MESSAGE_BYTES - PREFIX_BYTES : MAX_MESSAGE_BYTES
}
