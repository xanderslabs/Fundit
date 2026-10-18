import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'

// A new page opens at the top. Back and forward (POP) keep the browser's own restored position. Only a pathname
// change counts, so /me?add=1 and #section links do not jump.
export function ScrollToTop() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  const last = useRef(pathname)

  useEffect(() => {
    if (last.current === pathname) return
    last.current = pathname
    if (type !== 'POP') window.scrollTo(0, 0)
  }, [pathname, type])

  return null
}
