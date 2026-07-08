import { VerificationEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  verificationUrl:
    'https://spliit.app/auth/verify-email?token=eyJhbGciOiJIUzI1NiJ9&callbackURL=https%3A%2F%2Fspliit.app',
}

export default function Preview() {
  return <VerificationEmail {...props} />
}

Preview.PreviewProps = props
