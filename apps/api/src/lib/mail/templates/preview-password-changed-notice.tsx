import { PasswordChangedNoticeEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  resetUrl: 'https://spliit.app/auth/forgot-password',
}

export default function Preview() {
  return <PasswordChangedNoticeEmail {...props} />
}

Preview.PreviewProps = props
