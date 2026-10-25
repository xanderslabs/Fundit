import type { ReactNode } from 'react'
import { Card } from '../../src/components/ui'

// Every number in the panel sits in a Tile with a one-line note on where it comes from.
export function Tile({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <Card>
      <div className="admin-tile">
        <h2 className="admin-tile-title">{title}</h2>
        <div className="admin-tile-body">{children}</div>
        <p className="admin-tile-source">{source}</p>
      </div>
    </Card>
  )
}
