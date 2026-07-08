import { MagicLinkEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  signInUrl:
    'https://spliit.app/auth/magic-link/verify?token=eyJhbGciOiJIUzI1NiJ9&callbackURL=https%3A%2F%2Fspliit.app',
}

export default function Preview() {
  return <MagicLinkEmail {...props} />
}

Preview.PreviewProps = props
