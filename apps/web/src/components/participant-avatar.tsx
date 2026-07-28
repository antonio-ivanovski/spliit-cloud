import type { ComponentProps } from 'react'

import { AccountAvatar } from '@/components/account-avatar'
import type { AccountIdentity } from '@/lib/account'

type ParticipantIdentity = {
  id: string
  name: string
  account?: AccountIdentity | null
}

type Props = Omit<ComponentProps<typeof AccountAvatar>, 'account'> & {
  participant: ParticipantIdentity
}

export function ParticipantAvatar({ participant, ...props }: Props) {
  return (
    <AccountAvatar
      account={
        participant.account ?? { id: participant.id, name: participant.name }
      }
      {...props}
    />
  )
}
