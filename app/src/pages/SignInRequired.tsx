import { SignInButton } from '../components/AccountMenu'
import { ButtonLink } from '../components/ui'
import './SignInRequired.css'

// The page a signed-out person sees on an account-only page (My page, Start a Fundit, Manage). It stays on the same
// address, so the page itself shows once they sign in. text says what the page is for.
export function SignInRequired({ text }: { text: string }) {
  return (
    <section className="signin-required">
      <h1>Sign in to continue</h1>
      <p className="signin-required-text">{text}</p>
      <div className="signin-required-actions">
        <SignInButton className="ui-btn ui-btn-primary ui-btn-lg" />
        <ButtonLink to="/" variant="secondary" size="lg">
          Go home
        </ButtonLink>
      </div>
    </section>
  )
}
