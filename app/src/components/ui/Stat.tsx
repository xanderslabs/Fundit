import './Stat.css'

// A figure and its label (balances, the amount raised). The figure uses tabular digits so they line up.
export function Stat({ value, label, size = 'md' }: { value: string; label: string; size?: 'md' | 'lg' }) {
  return (
    <div className={`ui-stat ui-stat-${size}`}>
      <span className="ui-stat-value">{value}</span>
      <span className="ui-stat-label">{label}</span>
    </div>
  )
}
