import { describe, expect, it } from 'vitest'
import { bpsToPercent, formatAmount, formatExact, orList, parseAmount, progressPercent } from './format'

describe('parseAmount', () => {
  // Amounts are 6-decimal ERC-20 units, so "0.1" must be 100000n, never an 18-decimal value.
  it('parses a decimal into 6-decimal units', () => {
    expect(parseAmount('0.1')).toEqual({ ok: true, value: 100000n })
    expect(parseAmount('25')).toEqual({ ok: true, value: 25000000n })
    expect(parseAmount('1.123456')).toEqual({ ok: true, value: 1123456n })
  })

  // Each of these would either send the wrong amount or nothing, so submit must be blocked with a reason.
  it.each(['1,000', '1.1234567', '-1', '', '1e3', '0', '.', '0.000000', ' 1', '1.2.3'])('rejects %j with a message', (input) => {
    const result = parseAmount(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('formatAmount', () => {
  it('shows 2 decimals with a thousands separator', () => {
    expect(formatAmount(1234560000n, 'USDC')).toBe('1,234.56 USDC')
    expect(formatAmount(0n, 'USDC')).toBe('0.00 USDC')
  })

  it('shows up to 6 decimals below 0.01 so small amounts do not read as zero', () => {
    expect(formatAmount(5000n, 'EURC')).toBe('0.005 EURC')
    expect(formatAmount(1n, 'USDC')).toBe('0.000001 USDC')
  })
})

describe('bpsToPercent', () => {
  it('converts basis points', () => {
    expect(bpsToPercent(250)).toBe('2.5%')
    expect(bpsToPercent(100)).toBe('1%')
    expect(bpsToPercent(0)).toBe('0%')
  })
})

describe('progressPercent', () => {
  it('caps the bar at 100', () => {
    expect(progressPercent(50n, 100n)).toBe(50)
    expect(progressPercent(300n, 100n)).toBe(100)
    expect(progressPercent(10n, 0n)).toBe(0)
  })
})

describe('formatExact', () => {
  // A donor confirms what they pay. A total cut to 2 decimals would show less than the wallet takes.
  it('shows every unit up to 6 decimals, with at least 2', () => {
    expect(formatExact(10_849999n, 'USDC')).toBe('10.849999 USDC')
    expect(formatExact(105_000000n, 'USDC')).toBe('105.00 USDC')
    expect(formatExact(2_500000n, 'EURC')).toBe('2.50 EURC')
    expect(formatExact(1_250500n, 'USDC')).toBe('1.2505 USDC')
    expect(formatExact(1234_000001n, 'USDC')).toBe('1,234.000001 USDC')
    expect(formatExact(0n, 'USDC')).toBe('0.00 USDC')
    expect(formatExact(1n, 'USDC')).toBe('0.000001 USDC')
  })
})

describe('orList', () => {
  it('joins names with commas and a final "or"', () => {
    expect(orList(['A'])).toBe('A')
    expect(orList(['A', 'B'])).toBe('A or B')
    expect(orList(['A', 'B', 'C'])).toBe('A, B or C')
    expect(orList([])).toBe('')
  })
})
