import { useMemo } from 'react'
import type { Address } from 'viem'

// The 8 by 8 picture block explorers and many wallets draw for an address (the ethereum-blockies pattern, seeded
// with the lowercase address), so an account looks the same in Fundit as it does there.
const SIZE = 8

function blockie(seed: string) {
  const s: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < seed.length; i++) {
    const k = (i % 4) as 0 | 1 | 2 | 3
    s[k] = (s[k] << 5) - s[k] + seed.charCodeAt(i)
  }
  const rand = () => {
    const t = s[0] ^ (s[0] << 11)
    s[0] = s[1]
    s[1] = s[2]
    s[2] = s[3]
    s[3] = s[3] ^ (s[3] >> 19) ^ t ^ (t >> 8)
    return (s[3] >>> 0) / ((1 << 31) >>> 0)
  }
  const color = () => {
    const h = Math.floor(rand() * 360)
    const sat = rand() * 60 + 40
    const light = (rand() + rand() + rand() + rand()) * 25
    return `hsl(${h} ${sat}% ${light}%)`
  }
  const colors = [color(), color(), color()] as const
  const half = Math.ceil(SIZE / 2)
  const cells: number[] = []
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = []
    for (let x = 0; x < half; x++) row.push(Math.floor(rand() * 2.3))
    cells.push(...row, ...row.slice(0, SIZE - half).reverse())
  }
  // Cell value 0 is the background, 1 the main colour, 2 the spot colour.
  return { fg: colors[0], bg: colors[1], spot: colors[2], cells }
}

export function Blockie({ address, size = 24 }: { address: Address; size?: number }) {
  const { fg, bg, spot, cells } = useMemo(() => blockie(address.toLowerCase()), [address])
  return (
    <svg className="blockie" width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect width={SIZE} height={SIZE} fill={bg} />
      {cells.map((v, i) => (v === 0 ? null : <rect key={i} x={i % SIZE} y={Math.floor(i / SIZE)} width="1" height="1" fill={v === 1 ? fg : spot} />))}
    </svg>
  )
}
