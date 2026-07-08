import { FriendLedgerEmail } from './friend-ledger'

const props = {
  webBase: 'https://spliit.app',
  inviterName: 'Alice',
  isNewUser: true,
}

export default function Preview() {
  return <FriendLedgerEmail {...props} />
}

Preview.PreviewProps = props
