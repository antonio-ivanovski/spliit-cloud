import { PasswordRemovedNoticeEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  resetUrl: 'https://spliit.app/auth/forgot-password',
}

export default function Preview() {
  return <PasswordRemovedNoticeEmail {...props} />
}

Preview.PreviewProps = props
