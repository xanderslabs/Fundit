import { act, render } from '@testing-library/react'
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrollToTop } from './ScrollToTop'

function setup() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <ScrollToTop />
            <Link to="/b">b</Link>
            <Outlet />
          </>
        ),
        children: [
          { path: '/a', element: <p>a</p> },
          { path: '/b', element: <p>b</p> },
        ],
      },
    ],
    { initialEntries: ['/a'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('ScrollToTop', () => {
  const scrollTo = vi.fn()
  beforeEach(() => {
    scrollTo.mockReset()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  })

  // A new page must open at its top, not at the old page's scroll position.
  it('scrolls to the top when the pathname changes on a push', async () => {
    const router = setup()
    await act(() => router.navigate('/b'))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('scrolls to the top when the pathname changes on a replace', async () => {
    const router = setup()
    await act(() => router.navigate('/b', { replace: true }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('does not scroll on first render', () => {
    setup()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  // Back and forward leave position to the browser.
  it('does not scroll on a POP', async () => {
    const router = setup()
    await act(() => router.navigate('/b'))
    scrollTo.mockReset()
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/a')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  // /me?add=1 opens a panel and #section jumps in the page: neither may reset the scroll.
  it('does not scroll on a query-only or hash-only change', async () => {
    const router = setup()
    await act(() => router.navigate('/a?add=1'))
    await act(() => router.navigate('/a?add=1#top'))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
