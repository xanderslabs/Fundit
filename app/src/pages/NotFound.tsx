import { Link } from 'react-router'

// The 404 page. fundit is for a Fundit address that is not a valid address or that the Fundit factory did not
// create: such an address may be a clone with a hostile creator, so it is never shown as a Fundit.
export function NotFound({ fundit = false }: { fundit?: boolean }) {
  return (
    <section className="not-found">
      <p className="not-found-code" aria-hidden="true">
        404
      </p>
      <h1>{fundit ? "This Fundit doesn't exist or the link is wrong." : "This page doesn't exist"}</h1>
      {!fundit && <p className="muted">The link may be wrong, or the page has moved.</p>}
      <div className="not-found-actions">
        <Link to="/explore" className="btn btn-lg">
          Explore Fundits
        </Link>
        <Link to="/" className="btn btn-lg btn-outline">
          Go home
        </Link>
      </div>
    </section>
  )
}
