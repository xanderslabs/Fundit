import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BaseError, HttpRequestError } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { explainError } from './errors'

// People must never see backend text: RPC wording, error codes, "unknown" or "undefined", a raw message copied
// in parentheses, or the old "Something went wrong". This walks the error texts in the source and the texts
// explainError gives for typical raw errors, and fails on any of those.
const BANNED: [string, RegExp][] = [
  ['RPC', /\bRPC\b/],
  ['error code', /error code/i],
  ['unknown', /\bunknown\b/i],
  ['undefined', /\bundefined\b/],
  ['parentheses', /[()]/],
  ['Something went wrong', /something went wrong/i],
  ['an em or en dash', /[–—]/],
  ['a curly quote', /[‘’“”]/],
]

function problems(text: string): string[] {
  return BANNED.filter(([, re]) => re.test(text)).map(([label]) => label)
}

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'abi' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// A string literal, single, double or template quoted. ${...} in a template stands for a value.
const LITERAL = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|` + '`((?:[^`\\\\]|\\\\.)*)`'

function literals(code: string): string[] {
  return [...code.matchAll(new RegExp(LITERAL, 'g'))].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, 'X'))
}

const sentence = (t: string) => / /.test(t) && /[.?!]$/.test(t.trim())

// Where error text lives: every sentence in lib/errors.ts, every PlainError, setError and error phase message,
// and the UPPER_CASE text constants those use.
function errorTexts(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path)
    const code = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
    const add = (texts: string[]) => texts.filter(sentence).forEach((text) => out.push({ file, text }))
    if (file === join('lib', 'errors.ts')) {
      add(literals(code))
      continue
    }
    for (const m of code.matchAll(/(?:PlainError|setError)\(([^;]*?)\)\s*(?:$|;|\n)/gm)) add(literals(m[1]!))
    for (const m of code.matchAll(/kind: 'error', message: ([^}]*)\}/g)) add(literals(m[1]!))
    for (const m of code.matchAll(/^(?:export )?const [A-Z][A-Z_]+ =\s*\n?\s*(['"`][\s\S]*?['"`])\s*$/gm)) add(literals(m[1]!))
  }
  return out
}

describe('user-facing error messages', () => {
  it('finds the error texts to check', () => {
    const texts = errorTexts().map((t) => t.text)
    expect(texts).toContain("That username is taken. Pick another one, or sign in if it's yours.")
    expect(texts).toContain("That didn't work. Check your connection and try again.")
    expect(texts.length).toBeGreaterThan(60)
  })

  it('contains no backend text in any error message in the source', () => {
    const bad = errorTexts()
      .map(({ file, text }) => ({ file, text, found: problems(text) }))
      .filter((x) => x.found.length > 0)
    expect(bad).toEqual([])
  })

  // The raw errors the app really meets, from viem, Circle's RP and bundler, wallets and the browser.
  const raw: unknown[] = [
    new BaseError('An unknown RPC error occurred.', { details: 'The username is duplicated.' }),
    Object.assign(new BaseError('An unknown RPC error occurred.', { details: 'Missing or invalid parameters' }), { code: -32602 }),
    Object.assign(new Error('Internal JSON-RPC error.'), { code: -32603 }),
    Object.assign(new Error('execution reverted (unknown custom error)'), { data: '0xdeadbeef' }),
    new HttpRequestError({ url: 'https://rpc.example', status: 502, details: 'Bad Gateway' }),
    new TypeError("Cannot read properties of undefined (reading 'address')"),
    new Error('Request failed with status code 500'),
    { message: 'undefined' },
    'plain string',
    undefined,
    null,
  ]
  it.each(raw.map((e, i) => [i, e] as const))('explains raw error %i without backend text', (_i, e) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(problems(explainError(e))).toEqual([])
    vi.mocked(console.error).mockRestore()
  })
})
