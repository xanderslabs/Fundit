import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu } from './Menu'

afterEach(cleanup)

function setup() {
  const copy = vi.fn()
  const signOut = vi.fn()
  render(
    <>
      <Menu
        label="Wallet"
        trigger="0x3552...916D"
        items={[
          { label: 'Copy address', onSelect: copy },
          { label: 'Sign out', onSelect: signOut },
        ]}
      />
      <p>Outside</p>
    </>,
  )
  return { copy, signOut, button: screen.getByRole('button', { name: 'Wallet' }) }
}

// The wallet, theme and network menus are the only way to sign out or change network, so they must work from the
// keyboard and never leave focus stranded.
describe('Menu', () => {
  it('opens on click and focuses the first item', async () => {
    const { button } = setup()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy address' }))
  })

  it('moves focus with Arrow Down and Arrow Up, wrapping at the ends', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy address' }))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })

  it('closes on Escape and gives focus back to the button', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('closes on a click outside', async () => {
    const { button } = setup()
    await userEvent.click(button)
    await userEvent.click(screen.getByText('Outside'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('calls onSelect for the chosen item and closes', async () => {
    const { button, copy, signOut } = setup()
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(copy).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not call onSelect for a disabled item', async () => {
    const pick = vi.fn()
    render(<Menu label="Network" trigger="Arc Mainnet" items={[{ label: 'Arc Testnet', onSelect: pick, disabled: true, hint: 'Not the owner on this network' }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Network' }))
    const item = screen.getByRole('menuitem', { name: /Arc Testnet/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(item)
    expect(pick).not.toHaveBeenCalled()
  })
})
