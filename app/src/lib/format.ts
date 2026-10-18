import type { TokenSymbol } from '../config'

const DECIMALS = 6
const UNIT = 10n ** BigInt(DECIMALS)

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string }

// Parses what a person types into 6-decimal token units. Only digits and one dot, so "1,000" and "1e3" fail.
export function parseAmount(input: string): ParseResult {
  if (input === '') return { ok: false, error: 'Enter an amount.' }
  if (!/^\d*\.?\d*$/.test(input) || input === '.') {
    return { ok: false, error: 'Use digits and one dot only, for example 25 or 0.5.' }
  }
  const [whole = '', fraction = ''] = input.split('.')
  if (fraction.length > DECIMALS) return { ok: false, error: 'Use at most 6 digits after the dot.' }
  const value = BigInt(whole || '0') * UNIT + BigInt(fraction.padEnd(DECIMALS, '0'))
  if (value === 0n) return { ok: false, error: 'Enter an amount above 0.' }
  return { ok: true, value }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 2 decimals, or up to 6 when the value is below 0.01 so small amounts do not show as 0.00.
export function formatAmount(value: bigint, symbol: TokenSymbol): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / UNIT
  const fraction = (abs % UNIT).toString().padStart(DECIMALS, '0')
  let shown: string
  if (abs > 0n && abs < UNIT / 100n) {
    shown = `0.${fraction.replace(/0+$/, '')}`
  } else {
    // Truncate, never round up, so we never show more than is there.
    shown = `${groupThousands(whole.toString())}.${fraction.slice(0, 2)}`
  }
  return `${negative ? '-' : ''}${shown} ${symbol}`
}

// Every unit, for amounts a donor confirms: at least 2 decimals and up to all 6, so nothing is cut off.
export function formatExact(value: bigint, symbol: TokenSymbol): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const fraction = (abs % UNIT).toString().padStart(DECIMALS, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${negative ? '-' : ''}${groupThousands((abs / UNIT).toString())}.${fraction} ${symbol}`
}

export function bpsToPercent(bps: number): string {
  return `${bps / 100}%`
}

// The bar is capped at 100. Use realPercent for the text, which can go past 100.
export function progressPercent(raised: bigint, goal: bigint): number {
  return Math.min(100, realPercent(raised, goal))
}

export function realPercent(raised: bigint, goal: bigint): number {
  if (goal <= 0n) return 0
  return Number((raised * 100n) / goal)
}

// "A", "A or B", "A, B or C".
export function orList(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}
