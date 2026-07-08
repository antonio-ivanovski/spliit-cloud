import { PasswordRecoveryEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  resetUrl:
    'https://spliit.app/auth/reset-password/abc123?token=eyJhbGciOiJIUzI1NiJ9',
  otherMethods: ['Google', 'email sign-in link'],
}

export default function Preview() {
  return <PasswordRecoveryEmail {...props} />
}

Preview.PreviewProps = props
