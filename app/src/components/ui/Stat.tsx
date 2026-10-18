import './Stat.css'

// A figure and its label (balances, the amount raised). The figure uses tabular digits so they line up.
// term renders the label and figure as dt and dd, for a Stat inside a <dl>. The figure still shows first.
export function Stat({ value, label, size = 'md', term = false }: { value: string; label: string; size?: 'md' | 'lg'; term?: boolean }) {
  if (term) {
    return (
      <div className={`ui-stat ui-stat-${size}`}>
        <dt className="ui-stat-label">{label}</dt>
        <dd className="ui-stat-value">{value}</dd>
      </div>
    )
  }
  return (
    <div className={`ui-stat ui-stat-${size}`}>
      <span className="ui-stat-value">{value}</span>
      <span className="ui-stat-label">{label}</span>
    </div>
  )
}
