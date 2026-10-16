import { Link } from 'react-router'

export function NotFound() {
  return (
    <section className="notice">
      <h1>Page not found</h1>
      <p>
        This page does not exist. <Link to="/">Go to the home page</Link>.
      </p>
    </section>
  )
}
