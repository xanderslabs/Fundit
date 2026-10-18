import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/components/ui/Tabs.css', 'utf8')

// jsdom has no layout, so this reads the rules. Tab lists must never scroll sideways; the tabs share the row.
describe('tab list styles', () => {
  it('never scrolls or fades its tabs', () => {
    const rules = [...css.matchAll(/\.ui-tab-list\s*\{[^}]*\}/g)].map((m) => m[0]).join('\n')
    expect(rules).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
    expect(rules).not.toMatch(/mask-image/)
  })

  it('lets tabs shrink and share the width', () => {
    const tab = css.match(/\n\.ui-tab\s*\{[^}]*\}/)![0]
    expect(tab).toMatch(/flex\s*:\s*1 1 0/)
    expect(tab).toMatch(/min-width\s*:\s*0/)
    expect(tab).not.toMatch(/white-space\s*:\s*nowrap/)
  })

  // A long label wraps, but to two lines at most, so the row keeps one height.
  it('wraps a label to two lines at most', () => {
    const label = css.match(/\n\.ui-tab-label\s*\{[^}]*\}/)![0]
    expect(label).toMatch(/line-clamp\s*:\s*2/)
  })
})
