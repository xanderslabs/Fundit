// @vitest-environment node
import { readFileSync } from 'node:fs'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

// Lints a snippet through the real .stylelintrc.json, as if it lived in a new ui component file.
async function lint(code: string, codeFilename = 'src/components/ui/Probe.css') {
  const { results } = await stylelint.lint({ code, codeFilename, configFile: '.stylelintrc.json' })
  const result = results[0]!
  return { ignored: result.ignored === true, errors: result.warnings.map((w) => w.text) }
}

// The guardrail is what stops pages drifting back to one-off values, so it must catch every way of
// writing a raw colour or size, and must still let tokens through.
describe('CSS lint guardrail', () => {
  it.each([
    'font-size: 14px',
    'margin: 3px 0',
    'padding: var(--space-2) 14px',
    'gap: 1rem',
    'row-gap: 6px',
    'column-gap: 6px',
    'border-radius: 10px',
    'color: #fff',
    'color: rgb(16 25 40)',
    'color: rgba(16, 25, 40, 0.5)',
    'color: hsl(220 20% 20%)',
    'color: hsla(220, 20%, 20%, 0.5)',
    'color: red',
    'color: white',
    'background: #eceff1',
    'background: rgb(255 255 255)',
    'background: white',
    'background-color: hsl(0 0% 100%)',
    'background-color: black',
    'background: linear-gradient(red, blue)',
    'background: linear-gradient(90deg, #fff 0%, var(--surface) 100%)',
    // A raw size hidden inside a function is still a raw size.
    'margin: calc(8px * -1)',
    'padding: calc(4px + 2px)',
    'padding: calc(var(--space-2) + 2px) 0',
    'gap: max(8px, 1rem)',
    'font-size: clamp(12px, 2vw, 20px)',
    'border-radius: min(var(--radius-lg), 10px)',
  ])('rejects %s', async (decl) => {
    const { errors } = await lint(`.probe { ${decl}; }`)
    // A raw colour can trip both the token rule and a colour rule, so count at least one error.
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  // The colour rules cover every property, not only color and background: a raw colour in a border, a shadow,
  // an outline or an SVG fill would otherwise slip past the token rule.
  it.each([
    'border: 1px solid #ddd',
    'border-color: rgb(0 0 0)',
    'box-shadow: 0 0 0 3px red',
    'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2)',
    'outline-color: rgb(0 0 0)',
    'outline: 2px solid hsl(0 0% 0%)',
    'fill: #fff',
    'stroke: white',
  ])('rejects a raw colour in %s', async (decl) => {
    const { errors } = await lint(`.probe { ${decl}; }`)
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it.each(['border: 1px solid var(--border)', 'box-shadow: var(--shadow-1)', 'outline: 2px solid var(--focus)', 'fill: currentColor', 'border-color: transparent'])(
    'allows %s',
    async (decl) => {
      const { errors } = await lint(`.probe { ${decl}; }`)
      expect(errors).toEqual([])
    },
  )

  it.each([
    'margin: 0 auto',
    'padding: var(--space-2) var(--space-4)',
    'gap: var(--space-3)',
    'row-gap: var(--space-2)',
    'column-gap: var(--space-2)',
    'border-radius: 50%',
    'font-size: var(--text-md)',
    'margin: calc(var(--space-2) * -1) 0',
    'padding: calc(var(--space-4) + var(--space-1))',
    'gap: max(var(--space-2), 2%)',
    'border: 1px solid var(--border)',
    'outline: 2px solid var(--focus)',
    'color: var(--text)',
    'color: transparent',
    'color: currentColor',
    'color: inherit',
    'background: var(--surface)',
    'background: transparent',
    'background: none',
    'background-color: currentColor',
    'background: url(/img/x.png) no-repeat center / cover',
    'background: linear-gradient(90deg, var(--surface) 0%, var(--bg) 100%)',
  ])('allows %s', async (decl) => {
    const { errors } = await lint(`.probe { ${decl}; }`)
    expect(errors).toEqual([])
  })

  // The spec's "done" line: Stylelint passes on every CSS file with no exceptions. An allowlisted file could
  // hold raw sizes and colours that no check ever sees.
  it('stylelint allowlist is empty', () => {
    const config = JSON.parse(readFileSync('.stylelintrc.json', 'utf8')) as { ignoreFiles?: string[] }
    expect(config.ignoreFiles ?? []).toEqual([])
  })

  it('lints base.css, and lets tokens.css define raw colours', async () => {
    const base = await lint('.x { color: red; }', 'src/styles/base.css')
    expect(base.ignored).toBe(false)
    expect(base.errors.length).toBeGreaterThanOrEqual(1)
    expect((await lint(':root { --red: #ff3b30; --veil: rgb(16 25 40 / 0.45); }', 'src/styles/tokens.css')).errors).toEqual([])
  })
})
