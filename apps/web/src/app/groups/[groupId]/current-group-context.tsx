import type { AppRouterOutput } from '@spliit/api/router'
import { PropsWithChildren, createContext, useContext } from 'react'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type CurrentMember = NonNullable<
  AppRouterOutput['groups']['get']['currentMember']
>

type GroupContext =
  | {
      isLoading: false
      groupId: string
      group: Group
      // Server-backed ledger participant id for the signed-in account in
      // this group. Replaces the localStorage "activeUser" selection.
      currentLedgerParticipantId: string | null
      // Server-backed membership snapshot for the signed-in account.
      // Used to gate owner/admin-only surfaces (e.g. member management).
      currentMember: CurrentMember
    }
  | {
      isLoading: true
      groupId: string
      group: undefined
      currentLedgerParticipantId: undefined
      currentMember: undefined
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
