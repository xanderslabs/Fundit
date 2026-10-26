import logoDark from '../../../public/images/fundit-logo-dark.svg'
import logo from '../../../public/images/fundit-logo.svg'
import mark from '../../../public/images/icon.svg'

// The Fundit logo, light or dark to match the theme. CSS shows one: the mark alone in the narrow sidebar.
export function Logo() {
  return (
    <span className="admin-logo">
      <img className="admin-logo-light" src={logo} alt="Fundit" width={139} height={32} />
      <img className="admin-logo-dark" src={logoDark} alt="Fundit" width={139} height={32} />
      <img className="admin-logo-mark" src={mark} alt="Fundit" width={32} height={32} />
    </span>
  )
}
