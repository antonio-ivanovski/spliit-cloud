import { AccountDeletionRequestedEmail } from './account-deletion'

const props = {
  brandBaseUrl: 'https://spliit.app',
  executeAtLabel: 'September 24, 2026 at 2:23:00 PM UTC',
  keepDisplayName: false,
  deletionUrl: 'https://spliit.app/account/delete',
  feedbackUrl: 'https://spliit.app/feedback',
  exportUrl: 'https://spliit.app/account/settings#account-export',
}

export default function Preview() {
  return <AccountDeletionRequestedEmail {...props} />
}

Preview.PreviewProps = props
