import { PasswordSetNoticeEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  resetUrl: 'https://spliit.app/auth/forgot-password',
}

export default function Preview() {
  return <PasswordSetNoticeEmail {...props} />
}

Preview.PreviewProps = props
