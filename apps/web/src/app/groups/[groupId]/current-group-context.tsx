import type { PropsWithChildren } from 'react'
import { createContext, useContext } from 'react'

import type { AppRouterOutput } from '@spliit/api/router'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type CurrentMember = NonNullable<
  AppRouterOutput['groups']['get']['currentMember']
>
type CurrentInvitation = NonNullable<
  AppRouterOutput['groups']['get']['currentInvitation']
>
type LinkInviteState = NonNullable<
  AppRouterOutput['groups']['get']['linkInviteState']
>

type GroupContext =
  | {
      isLoading: false
      groupId: string
      group: Group
      // Human-readable display name. For regular groups this is the
      // stored name; for FRIEND-typed groups this is resolved
      // server-side from the peer member's account name, a pending
      // invitation's temporary name, or the invitation email.
      displayName: string
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
      // State of the URL-borne link-invite token, if any. Drives the
      // "already a member" / "no longer valid" banners when the token
      // resolves to a non-PENDING invitation. `null` when the URL has
      // no token (or it didn't match anything).
      linkInviteState: LinkInviteState | null
    }
  | {
      isLoading: true
      groupId: string
      group: undefined
      displayName: undefined
      currentLedgerParticipantId: undefined
      currentMember: undefined
      currentInvitation: undefined
      linkInviteState: undefined
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
 * Like {@link useCurrentGroup} but returns `null` when the caller is not inside
 * a {@link CurrentGroupProvider}. Use this from hooks that may run outside the
 * group layout (e.g. page-level controls) without throwing.
 */
export const useCurrentGroupOrNull = () => useContext(CurrentGroupContext)

/**
 * True when the signed-in viewer is a PENDING invitee of this group (i.e. their
 * account email matches a PENDING GroupInvitation, and they have not yet
 * accepted). Pending invitees can read the group, but every mutation
 * (create/update/delete/archive/invitations) is rejected on the server and edit
 * affordances are hidden in the UI.
 */
// react-doctor-disable-next-line react-doctor/only-export-components -- hook export (use[A-Z]) allowed per rule docs
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
