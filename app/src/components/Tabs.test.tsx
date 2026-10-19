import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ContentTabs as Tabs } from './ui/Tabs'

afterEach(cleanup)

const TABS = [
  { id: 'one', label: 'One', content: <p>First panel</p> },
  { id: 'two', label: 'Two', content: <input aria-label="Draft" /> },
  { id: 'three', label: 'Three', content: <p>Third panel</p> },
]

function selected() {
  return screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))
}

describe('Tabs', () => {
  // Screen readers announce a tab list, which tab is chosen and which panel it controls.
  it('renders a labelled tab list with the first tab selected and its panel shown', () => {
    render(<Tabs label="Sections" tabs={TABS} />)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['One', 'Two', 'Three'])
    expect(selected()).toEqual(['true', 'false', 'false'])
    const panel = screen.getByRole('tabpanel', { name: 'One' })
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.textContent).toBe('First panel')
    expect(screen.queryByText('Third panel')).toBeNull()
  })

  // Only the chosen tab is in the Tab order. The arrow keys move between tabs, as in the ARIA tabs pattern.
  it('moves and selects with the arrow keys, wrapping at the ends, and Home and End', async () => {
    render(<Tabs label="Sections" tabs={TABS} />)
    const user = userEvent.setup()
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1])
    screen.getByRole('tab', { name: 'One' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Two' }))
    expect(selected()).toEqual(['false', 'true', 'false'])
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, 0, -1])
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'One' }))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Three' }))
    expect(screen.getByRole('tabpanel').textContent).toBe('Third panel')
    await user.keyboard('{Home}')
    expect(selected()).toEqual(['true', 'false', 'false'])
    await user.keyboard('{End}')
    expect(selected()).toEqual(['false', 'false', 'true'])
  })

  it('selects a tab on click', async () => {
    render(<Tabs label="Sections" tabs={TABS} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Three' }))
    expect(selected()).toEqual(['false', 'false', 'true'])
    expect(screen.getByRole('tabpanel', { name: 'Three' }).textContent).toBe('Third panel')
  })

  // A form with money in flight must not lose its state when the person looks at another tab.
  it('keeps a visited panel mounted but hidden when keepMounted is set', async () => {
    render(<Tabs label="Sections" tabs={TABS} keepMounted />)
    const user = userEvent.setup()
    expect(screen.queryByLabelText('Draft')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    await user.type(screen.getByLabelText('Draft'), '25')
    await user.click(screen.getByRole('tab', { name: 'One' }))
    expect(screen.queryByRole('textbox', { name: 'Draft' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value).toBe('25')
  })
})
