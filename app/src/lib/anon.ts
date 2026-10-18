import { MAX_MESSAGE_BYTES } from '../config'

// The contract has no donor privacy field, so the marker lives at the start of the message. It costs 6 bytes.
export const ANON_PREFIX = '[anon]'
const PREFIX_BYTES = 6

export function markAnonymous(message: string): string {
  return ANON_PREFIX + message
}

// A message that starts with the marker is anonymous, whether or not the box was ticked. The marker is the record.
export function readMessage(raw: string): { anonymous: boolean; text: string } {
  return raw.startsWith(ANON_PREFIX) ? { anonymous: true, text: raw.slice(ANON_PREFIX.length) } : { anonymous: false, text: raw }
}

export function messageLimit(anonymous: boolean): number {
  return anonymous ? MAX_MESSAGE_BYTES - PREFIX_BYTES : MAX_MESSAGE_BYTES
}
