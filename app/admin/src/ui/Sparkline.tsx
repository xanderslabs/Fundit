// A small trend line drawn by hand in SVG (no chart library). It draws only with at least two points; with fewer
// the card shows its number alone. label describes the trend for screen readers.
const W = 120
const H = 32
const PAD = 2

export function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = (W - 2 * PAD) / (points.length - 1)
  const d = points
    .map((p, i) => {
      const x = PAD + i * step
      const y = H - PAD - ((p - min) / span) * (H - 2 * PAD)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="admin-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
