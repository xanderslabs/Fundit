import type { TokenSymbol } from '../../../src/config'
import { formatAmount } from '../../../src/lib/format'

// A token amount, always with its symbol, in tabular figures. USDC and EURC are never added together, so there is
// no total form.
export function Amount({ value, token }: { value: bigint; token: TokenSymbol }) {
  return <span className="admin-amount">{formatAmount(value, token)}</span>
}
