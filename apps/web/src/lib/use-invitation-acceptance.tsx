import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

type InvitationTarget = { token: string } | { invitationId: string }

/** Both explicit Accept and a completed Sign in to accept use this owner. */
export function useInvitationAcceptance(input: {
  groupId: string
  token?: string
  invitationId?: string
  invitationAction?: 'accept'
}) {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const {
    account,
    authReturnSettled,
    onboardingComplete,
    statusError,
    refetchStatus,
  } = useOnboardingStatus()
  const isOnline = useOnlineStatus()
  // A committed route/identity owns its work; cleanup fences stale continuations.
  const scope = useRef<object | null>(null)
  useEffect(() => {
    const owner = {}
    scope.current = owner
    return () => {
      if (scope.current === owner) scope.current = null
    }
  }, [
    account?.id,
    input.groupId,
    input.token,
    input.invitationId,
    input.invitationAction,
  ])
  const inFlight = useRef<{ owner: object; work: Promise<void> } | null>(null)
  const attempted = useRef<string | null>(null)
  const ready = !!account && authReturnSettled && onboardingComplete && isOnline
  const mutation = useMutation({
    retry: false,
    mutationFn: async (target: InvitationTarget) => {
      if (!ready) throw new Error(t('CompleteProfile.errors.generic'))
      const owner = scope.current
      if (!owner) return
      const isCurrent = () => scope.current === owner
      if (inFlight.current?.owner === owner) return inFlight.current.work
      const work = (async () => {
        // An active membership also settles repeated callbacks without consuming a use.
        const existing = await utils.client.groups.get
          .query({ groupId: input.groupId })
          .catch(() => null)
        if (!isCurrent()) return
        // A recipient-specific invitation discovered after sign-in owns the
        // ledger participant, even when the visitor originally followed a link.
        const resolvedTarget =
          'token' in target && existing?.currentInvitation?.type === 'EMAIL'
            ? { invitationId: existing.currentInvitation.id }
            : target
        if (!existing?.currentMember) {
          try {
            if ('token' in resolvedTarget) {
              await utils.client.invitations.acceptLink.mutate({
                ...resolvedTarget,
                expectedGroupId: input.groupId,
              })
            } else {
              await utils.client.invitations.accept.mutate({
                ...resolvedTarget,
                expectedGroupId: input.groupId,
              })
            }
          } catch (error) {
            // Another tab may have completed the same acceptance concurrently.
            const current = await utils.client.groups.get
              .query({ groupId: input.groupId })
              .catch(() => null)
            if (!current?.currentMember) throw error
          }
        }
        if (!isCurrent()) return
        await Promise.all([
          invalidateAccountGroupLists(utils),
          utils.groups.get.invalidate({ groupId: input.groupId }),
          utils.invitations.listForAccount.invalidate(),
          utils.invitations.list.invalidate({ groupId: input.groupId }),
          utils.account.members.invalidate({ groupId: input.groupId }),
        ])
        if (!isCurrent()) return
        const member = await utils.groups.get.fetch({ groupId: input.groupId })
        if (!isCurrent()) return
        if (!member.currentMember) throw new Error(t('Auth.errors.generic'))
        await navigate({
          to: '/groups/$groupId/expenses',
          params: { groupId: input.groupId },
          search: {
            invite: undefined,
            viewKey: undefined,
            invitation: undefined,
            invitationAction: undefined,
          },
          replace: true,
        })
      })()
      inFlight.current = { owner, work }
      try {
        await work
      } finally {
        if (inFlight.current?.work === work) inFlight.current = null
      }
    },
  })
  const { mutate } = mutation
  useEffect(() => {
    if (!ready || input.invitationAction !== 'accept') return
    const target = input.invitationId
      ? { invitationId: input.invitationId }
      : input.token
        ? { token: input.token }
        : null
    if (!target) return
    const key = JSON.stringify([account.id, input.groupId, target])
    if (attempted.current === key) return
    attempted.current = key
    mutate(target)
  }, [
    ready,
    account?.id,
    input.groupId,
    input.token,
    input.invitationId,
    input.invitationAction,
    mutate,
  ])
  return {
    ...mutation,
    onboardingError: statusError,
    refetchOnboarding: async () => {
      if (account?.isAnonymous === true) await refetchStatus()
    },
    retryAcceptance: () => {
      const target = input.invitationId
        ? { invitationId: input.invitationId }
        : input.token
          ? { token: input.token }
          : null
      if (target) mutation.mutate(target)
    },
    ready,
    automatic:
      input.invitationAction === 'accept' &&
      !!(input.token || input.invitationId),
  }
}

export const InvitationAcceptanceContext = createContext<ReturnType<
  typeof useInvitationAcceptance
> | null>(null)

export function useGroupInvitationAcceptance() {
  const value = useContext(InvitationAcceptanceContext)
  if (!value)
    throw new Error('Invitation acceptance requires the group layout.')
  return value
}
