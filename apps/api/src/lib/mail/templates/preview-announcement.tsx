import { AnnouncementEmail } from './announcement'

const props = {
  title: "Catch up on what's new",
  body: "Here's a roundup of features you might have missed.\n\n## Much faster categorization\n\nExpenses are now categorized in about 250ms. See the [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) notes.\n",
  brandBaseUrl: 'https://spliit.app',
  updatesUrl: 'https://spliit.app/updates',
  unsubscribeUrl: 'https://spliit.app/email/unsubscribe?token=preview',
}

export default function Preview() {
  return <AnnouncementEmail {...props} />
}

Preview.PreviewProps = props
