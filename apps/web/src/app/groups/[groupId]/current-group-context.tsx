import type { AppRouterOutput } from '@spliit/api/router'
import { PropsWithChildren, createContext, useContext } from 'react'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type CurrentMember = NonNullable<
  AppRouterOutput['groups']['get']['currentMember']
>
type CurrentInvitation = NonNullable<
  AppRouterOutput['groups']['get']['currentInvitation']
>

type GroupContext =
  | {
      isLoading: false
      groupId: string
      group: Group
      // Server-backed ledger participant id for the signed-in account in
      // this group. Replaces the localStorage "activeUser" selection.
      // Null for pending invitees who have not yet accepted.
      currentLedgerParticipantId: string | null
      // Server-backed membership snapshot for the signed-in account.
      // Used to gate owner/admin-only surfaces (e.g. member management).
      // Null for pending invitees who have not yet accepted.
      currentMember: CurrentMember | null
      // Set when the signed-in account is a pending invitee of this
      // group (the email matches and the invitation is PENDING). The
      // group header surfaces an Accept/Decline banner when this is
      // non-null. While a PENDING invitation is in place, the viewer
      // has read-only access — mutations are blocked on the server and
      // edit affordances are hidden in the UI.
      currentInvitation: CurrentInvitation | null
    }
  | {
      isLoading: true
      groupId: string
      group: undefined
      currentLedgerParticipantId: undefined
      currentMember: undefined
      currentInvitation: undefined
    }

const CurrentGroupContext = createContext<GroupContext | null>(null)

export const useCurrentGroup = () => {
  const context = useContext(CurrentGroupContext)
  if (!context)
    throw new Error(
      'Missing context. Should be called inside a CurrentGroupProvider.',
    )
  return context
}

/**
 * True when the signed-in viewer is a PENDING invitee of this group (i.e.
 * their account email matches a PENDING GroupInvitation, and they have not
 * yet accepted). Pending invitees can read the group, but every mutation
 * (create/update/delete/archive/invitations) is rejected on the server and
 * edit affordances are hidden in the UI.
 */
export function useIsPendingInvitee() {
  const { currentInvitation } = useCurrentGroup()
  return currentInvitation != null
}

export const CurrentGroupProvider = ({
  children,
  ...props
}: PropsWithChildren<GroupContext>) => {
  return (
    <CurrentGroupContext.Provider value={props}>
      {children}
    </CurrentGroupContext.Provider>
  )
}
