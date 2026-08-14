import { EmailChangedNoticeEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  newEmail: 'new@example.com',
}

export default function Preview() {
  return <EmailChangedNoticeEmail {...props} />
}

Preview.PreviewProps = props
