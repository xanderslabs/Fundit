import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openCircleWindow } from '../../lib/circleWindow'
import { Dialog } from './Dialog'

// jsdom has no top layer. These stand-ins track it the way a browser does: showModal puts the dialog in, close
// takes it out.
const topLayer = new Set<HTMLDialogElement>()
const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void }

beforeEach(() => {
  topLayer.clear()
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
    topLayer.add(this)
  })
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    topLayer.delete(this)
  })
})

afterEach(() => {
  cleanup()
  delete proto.showModal
  delete proto.close
})

// A field with state, standing in for the email form part way through sign-in.
function Form() {
  const [email, setEmail] = useState('')
  return <input aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
}

describe('Dialog while Circle\'s window is open', () => {
  // Circle draws its window in the page. A modal dialog in the top layer would sit over it and make it unreachable.
  it('leaves the top layer, hides and keeps its content, then comes back when Circle closes', () => {
    const onClose = vi.fn()
    render(
      <>
        <button type="button">Opener</button>
        <Dialog open onClose={onClose} title="Sign in">
          <Form />
        </Dialog>
      </>,
    )
    const dialog = document.querySelector('dialog')!
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ana@example.com' } })
    expect(topLayer.has(dialog)).toBe(true)

    let closeCircle = () => {}
    act(() => {
      closeCircle = openCircleWindow()
    })
    expect(topLayer.has(dialog)).toBe(false)
    expect(dialog.open).toBe(false)
    // Still mounted, with what the person typed, and not dismissed.
    expect(document.querySelector('dialog')).toBe(dialog)
    expect((screen.getByLabelText('Email address', { selector: 'input' }) as HTMLInputElement).value).toBe('ana@example.com')
    expect(onClose).not.toHaveBeenCalled()

    act(() => closeCircle())
    expect(topLayer.has(dialog)).toBe(true)
    expect(dialog.open).toBe(true)
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('ana@example.com')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a dialog that opens while Circle\'s window is up waits for it to close', () => {
    let closeCircle = () => {}
    act(() => {
      closeCircle = openCircleWindow()
    })
    render(
      <Dialog open onClose={() => {}} title="Sign in">
        <Form />
      </Dialog>,
    )
    const dialog = document.querySelector('dialog')!
    expect(topLayer.has(dialog)).toBe(false)
    act(() => closeCircle())
    expect(topLayer.has(dialog)).toBe(true)
  })
})
