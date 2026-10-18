import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readdirSync, readFileSync } from 'node:fs'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { AddressChip, AmountInput, Button, Dialog, Field, Stat, TabPanel, Tabs } from './index'

// Only the routing matters for the style guide check, so the real layout (wallet code, top bar) stays out.
vi.mock('../Layout', async () => {
  const { Outlet } = await import('react-router')
  return { Layout: () => <Outlet /> }
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const UI_DIR = 'src/components/ui'
const cssFiles = readdirSync(UI_DIR).filter((f) => f.endsWith('.css'))
const css = (file: string) => readFileSync(`${UI_DIR}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Splits CSS into top-level rules and @media blocks, so a rule inside a media query is not read as a page rule.
function parse(text: string): { rules: { selector: string; body: string }[]; media: { query: string; body: string }[] } {
  const rules: { selector: string; body: string }[] = []
  const media: { query: string; body: string }[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open === -1) break
    const head = text.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)
    if (head.startsWith('@')) media.push({ query: head, body })
    else rules.push({ selector: head, body })
    i = j
  }
  return { rules, media }
}

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const

describe('ui components', () => {
  // Every button style comes from one component. A button that is busy cannot be pressed twice, so a send can
  // never go out twice.
  it('Button renders variants and is disabled while loading', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" size="lg" block>
          Danger
        </Button>
        <Button loading onClick={onClick}>
          Sending
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Primary' }).className).toContain('ui-btn-primary')
    expect(screen.getByRole('button', { name: 'Secondary' }).className).toContain('ui-btn-secondary')
    expect(screen.getByRole('button', { name: 'Ghost' }).className).toContain('ui-btn-ghost')
    const danger = screen.getByRole('button', { name: 'Danger' })
    expect(danger.className).toContain('ui-btn-danger')
    expect(danger.className).toContain('ui-btn-lg')
    expect(danger.className).toContain('ui-btn-block')
    // A button with no type inside a form would submit it.
    expect(danger.getAttribute('type')).toBe('button')
    const busy = screen.getByRole('button', { name: 'Sending' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await userEvent.setup().click(busy)
    expect(onClick).not.toHaveBeenCalled()
  })

  // A screen reader user hears the hint and the error with the field, and the field is marked invalid.
  it('Field wires label, hint and error to the control', () => {
    const { rerender } = render(
      <Field id="amount" label="Amount" hint="Up to 5,000 USDC">
        <AmountInput id="amount" value="25" onChange={() => {}} currency="USDC" />
      </Field>,
    )
    const input = screen.getByLabelText('Amount')
    expect(input.tagName).toBe('INPUT')
    expect(screen.getByRole('textbox', { name: 'Amount' }).getAttribute('aria-describedby')).toContain('amount-hint')
    expect(screen.getByRole('textbox', { description: 'Up to 5,000 USDC' })).toBe(input)
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByText('USDC')).toBeTruthy()

    rerender(
      <Field id="amount" label="Amount" hint="Up to 5,000 USDC" error="Enter an amount">
        <AmountInput id="amount" value="" onChange={() => {}} currency="USDC" aria-describedby="balance" />
      </Field>,
    )
    const invalid = screen.getByLabelText('Amount')
    expect(invalid.getAttribute('aria-invalid')).toBe('true')
    // The control's own description stays, and the hint and error join it.
    expect(invalid.getAttribute('aria-describedby')!.split(' ').sort()).toEqual(['amount-error', 'amount-hint', 'balance'])
    expect(screen.getByText('Enter an amount').id).toBe('amount-error')
  })

  // The ARIA tabs pattern: only the chosen tab is in the Tab order, and the arrow keys move and select.
  it('Tabs move with arrow keys and set aria-selected', async () => {
    const TABS = [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
      { id: 'three', label: 'Three' },
    ]
    function Harness() {
      const [value, setValue] = useState('one')
      return (
        <>
          <Tabs label="Sections" tabs={TABS} value={value} onChange={setValue} />
          {TABS.map((t) => (
            <TabPanel key={t.id} id={t.id} active={value === t.id}>
              {t.label} panel
            </TabPanel>
          ))}
        </>
      )
    }
    render(<Harness />)
    const user = userEvent.setup()
    const selected = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy()
    expect(selected()).toEqual(['true', 'false', 'false'])
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1])
    const panel = screen.getByRole('tabpanel', { name: 'One' })
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.textContent).toBe('One panel')

    screen.getByRole('tab', { name: 'One' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Two' }))
    expect(selected()).toEqual(['false', 'true', 'false'])
    expect(screen.getByRole('tabpanel').textContent).toBe('Two panel')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'One' }))
    await user.keyboard('{ArrowLeft}')
    expect(selected()).toEqual(['false', 'false', 'true'])
    await user.keyboard('{Home}')
    expect(selected()).toEqual(['true', 'false', 'false'])
    await user.keyboard('{End}')
    expect(selected()).toEqual(['false', 'false', 'true'])
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    expect(selected()).toEqual(['false', 'true', 'false'])
  })

  // Keyboard users must not fall out of a dialog onto the page behind it, and must land back where they were.
  it('Dialog traps focus, closes on Escape and restores focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Sign in">
            <input aria-label="Username" />
            <button type="button">Continue</button>
          </Dialog>
        </>
      )
    }
    render(<Harness />)
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(dialog).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Username'))

    // Tab past the last control (Close) wraps to the first, and Shift+Tab from the first wraps to the last.
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByLabelText('Username'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  // The backup dialog asks before it closes while recovery words are on screen. If any way out skipped that
  // question, a person could lose the words with no warning.
  it('Dialog asks canClose before every way of closing', async () => {
    let allow = false
    const canClose = vi.fn(() => allow)
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Save your recovery key" canClose={canClose}>
          <button type="button">Copy words</button>
        </Dialog>
      )
    }
    render(<Harness />)
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'Save your recovery key' })

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeTruthy()
    // A click on the backdrop lands on the dialog element itself.
    await user.click(dialog)
    expect(screen.getByRole('dialog')).toBeTruthy()
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(canClose).toHaveBeenCalledTimes(4)

    allow = true
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Sign-in and the backup prompt bring their own heading. The dialog must take its name from it, with no
  // second heading of its own.
  it('Dialog takes its name from a child heading with labelledBy', () => {
    render(
      <Dialog open onClose={() => {}} labelledBy="child-heading">
        <h2 id="child-heading">Sign in to Fundit</h2>
      </Dialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Sign in to Fundit' })).toBeTruthy()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  // A field that cannot be changed must look different, not only refuse input.
  it('Field shows a disabled control as disabled', () => {
    const rule = parse(css('Field.css')).rules.find((r) => r.selector.includes(':disabled'))
    expect(rule?.selector).toMatch(/\.ui-input:disabled/)
    expect(rule?.body).toMatch(/background\s*:\s*var\(--surface\)/)
    expect(rule?.body).toMatch(/color\s*:\s*var\(--text-muted\)/)
  })

  // Digits in a balance must line up and not jump as the number changes.
  it('Stat uses tabular figures', () => {
    render(<Stat value="1,234,567.89 USDC" label="Raised" size="lg" />)
    const value = screen.getByText('1,234,567.89 USDC')
    expect(value.classList.contains('ui-stat-value')).toBe(true)
    expect(screen.getByText('Raised')).toBeTruthy()
    const rule = parse(css('Stat.css')).rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.ui-stat-value'))
    expect(rule?.body).toMatch(/font-variant-numeric\s*:\s*tabular-nums/)
    // Figures are weight 700 with no letter spacing, never the display weights.
    expect(rule?.body).toMatch(/font-weight\s*:\s*var\(--weight-bold\)/)
    expect(rule?.body).toMatch(/letter-spacing\s*:\s*var\(--tracking-body\)/)
  })

  // A short address is easier to read, but a copy must always give the full address, or money goes astray.
  it('AddressChip copies the full address and shows the short form', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AddressChip address={ADDRESS} explorer />)
    expect(screen.getByText('0x1234...5678')).toBeTruthy()
    expect(screen.queryByText(ADDRESS)).toBeNull()
    expect(screen.getByText('0x1234...5678').getAttribute('title')).toBe(ADDRESS)
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
    expect(await screen.findByText('Copied')).toBeTruthy()
    // The button goes back to its name, so a second copy is announced the same way.
    expect(await screen.findByRole('button', { name: 'Copy address' }, { timeout: 4000 })).toBeTruthy()
    const link = screen.getByRole('link', { name: /explorer/i })
    expect(link.getAttribute('href')).toMatch(new RegExp(`/address/${ADDRESS}$`))
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('AddressChip says so when the copy fails', async () => {
    // user-event installs its own clipboard, so the failing one goes in after setup.
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AddressChip address={ADDRESS} />)
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(await screen.findByText(/Could not copy/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('ui styles', () => {
  // Each interactive part needs a visible ring for keyboard users, in the one focus colour.
  it('every interactive ui component has a focus-visible style', () => {
    const all = cssFiles.flatMap((f) => parse(css(f)).rules)
    // Anything with a pointer cursor is something people press, so a new one is checked without editing this list.
    const interactive = [
      ...new Set(
        all
          .filter((r) => /cursor\s*:\s*pointer/.test(r.body))
          .flatMap((r) => r.selector.split(',').map((s) => s.trim()))
          .filter((s) => !s.includes(':')),
      ),
    ]
    expect(interactive).toEqual(expect.arrayContaining(['.ui-btn', '.ui-tab', '.ui-dialog-close', '.ui-panel-close', '.ui-address-copy', '.ui-address-link']))
    for (const selector of interactive) {
      const rule = all.find((r) => r.selector.split(',').map((s) => s.trim()).includes(`${selector}:focus-visible`))
      expect(rule, `${selector}:focus-visible`).toBeTruthy()
      expect(rule!.body, `${selector}:focus-visible`).toMatch(/outline\s*:[^;]*var\(--focus\)/)
    }
  })

  // Motion can make some people unwell. Each file turns its own motion off, not only the global reset.
  it('no ui transition when prefers-reduced-motion', () => {
    let moving = 0
    for (const file of cssFiles) {
      const { rules, media } = parse(css(file))
      const reduce = media
        .filter((m) => /prefers-reduced-motion\s*:\s*reduce/.test(m.query))
        .flatMap((m) => parse(m.body).rules)
      for (const rule of rules) {
        for (const prop of ['transition', 'animation'] as const) {
          if (!new RegExp(`(^|;|\\s)${prop}(-[\\w-]+)?\\s*:`).test(rule.body)) continue
          moving++
          const off = reduce.find(
            (r) =>
              r.selector.split(',').map((s) => s.trim()).some((s) => rule.selector.split(',').map((t) => t.trim()).includes(s)) &&
              new RegExp(`${prop}\\s*:\\s*none`).test(r.body),
          )
          expect(off, `${file}: ${rule.selector} ${prop}`).toBeTruthy()
        }
      }
    }
    // The check means nothing if no ui file moves at all.
    expect(moving).toBeGreaterThan(0)
  })
})

describe('style guide route', () => {
  function renderAt(path: string) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  // The style guide is a tool for builders. It must never ship to people using Fundit.
  it('styleguide route exists only in dev', async () => {
    vi.stubEnv('DEV', false)
    renderAt('/styleguide')
    expect(await screen.findByRole('heading', { name: "This page doesn't exist" })).toBeTruthy()
  })

  it('serves the style guide in dev', async () => {
    renderAt('/styleguide')
    // The page is lazy-loaded, and the first load in a test run can take a few seconds.
    expect(await screen.findByRole('heading', { level: 1, name: 'Style guide' }, { timeout: 10_000 })).toBeTruthy()
  })
})
