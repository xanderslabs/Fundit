import { progressPercent, realPercent } from '../lib/format'
import './Progress.css'

type Props = { raised: bigint; goal: bigint; size?: 'sm' | 'lg' }

// The bar stops at 100%. The label shows the real number, which can go past 100%.
export function Progress({ raised, goal, size = 'sm' }: Props) {
  const bar = progressPercent(raised, goal)
  const label = `${realPercent(raised, goal)}%`
  return (
    <div className={`progress progress-${size}`}>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bar}
        aria-valuetext={label}
        aria-label="Raised toward goal"
      >
        <div className={bar >= 100 ? 'progress-fill progress-done' : 'progress-fill'} style={{ width: `${bar}%` }} />
      </div>
      <span className="progress-label">{label}</span>
    </div>
  )
}
