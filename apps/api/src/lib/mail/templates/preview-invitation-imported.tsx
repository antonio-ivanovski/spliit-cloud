import { GroupRole } from '@spliit/db'

import { InvitationEmail } from './invitation'

const props = {
  invitationId: 'inv-import-1',
  groupId: 'grp-imp-1',
  groupName: 'Imported Trip',
  inviterDisplayName: 'Alice',
  inviterRole: GroupRole.ADMIN,
  recipientEmail: 'friend@example.com',
  recipientIsExistingUser: false,
  temporaryName: 'Friend One',
  sourceProvider: 'SPLIIT',
  sourceGroupName: 'Previous Trip',
  expenseCount: 2,
  totalAmount: 3500,
  currencyCode: 'USD',
  acceptUrl: 'https://spliit.app/groups/grp-imp-1',
  signInUrl: 'https://spliit.app/?invitation=inv-import-1',
  brandBaseUrl: 'https://spliit.app',
}

export default function Preview() {
  return <InvitationEmail {...props} />
}

Preview.PreviewProps = props
