import { GroupRole } from '@spliit/db'

import { InvitationEmail } from './invitation'

const props = {
  invitationId: 'inv-abc123',
  groupId: 'grp-1',
  groupName: 'Roadtrip 2026',
  inviterDisplayName: 'Alice',
  inviterRole: GroupRole.ADMIN,
  recipientEmail: 'bob@example.com',
  recipientIsExistingUser: true,
  temporaryName: 'Bob',
  acceptUrl: 'https://spliit.app/groups/grp-1',
  signInUrl: 'https://spliit.app/?invitation=inv-abc123',
  brandBaseUrl: 'https://spliit.app',
}

export default function Preview() {
  return <InvitationEmail {...props} />
}

Preview.PreviewProps = props
