import { EmailChangeOtpEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  otp: '482917',
  expiresInMinutes: 10,
}

export default function Preview() {
  return <EmailChangeOtpEmail {...props} />
}

Preview.PreviewProps = props
