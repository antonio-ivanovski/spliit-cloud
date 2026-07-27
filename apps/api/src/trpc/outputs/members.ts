import { z } from 'zod'

export const memberRoleOutputSchema = z.object({
  memberId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER']),
})

export const removeMemberOutputSchema = z.object({
  memberId: z.string(),
})

export const removeMemberPreviewOutputSchema = z.object({
  memberName: z.string(),
  hasUnsettledBalance: z.boolean(),
})

export const participantRemovalPreviewOutputSchema = z.object({
  participantName: z.string(),
  participantKind: z.enum(['member', 'invitation', 'unlinked']),
  hasUnsettledBalance: z.boolean(),
  currentBalance: z.number().int(),
  settlementLegs: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number().int(),
    }),
  ),
  currencyCode: z.string().nullable(),
  participants: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const participantRemovalOutputSchema = z.object({
  ledgerParticipantId: z.string(),
  kind: z.enum(['member', 'invitation', 'unlinked']),
})
