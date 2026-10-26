// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Card } from './Card'

afterEach(cleanup)

// Spec goal 3: a rate limit is shown as a rate limit, so the owner waits instead of hunting for a fault.
describe('Card', () => {
  it('says the RPC asked us to slow down when the read failed on a rate limit', () => {
    render(<Card title="Raised" state="error" error={{ shortMessage: 'Request failed', cause: { code: -32005 } }} />)
    expect(screen.getByText('The RPC asked us to slow down. Try again in a moment.')).toBeTruthy()
    expect(screen.queryByText("Couldn't load this.")).toBeNull()
  })

  it("says Couldn't load this. for any other failure", () => {
    render(<Card title="Raised" state="error" error={new Error('boom')} />)
    expect(screen.getByText("Couldn't load this.")).toBeTruthy()
  })
})
