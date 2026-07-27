import { z } from 'zod'

export const unlinkedParticipantsOutputSchema = z.object({
  unlinked: z.array(
    z.object({
      id: z.string(),
      displayName: z.string().nullable(),
    }),
  ),
})

export const importLinkCandidatesOutputSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(['MEMBER', 'PENDING']),
      email: z.string(),
      invitationId: z.string().nullable(),
    }),
  ),
})

export const importLinkOutputSchema = z.object({
  groupMemberId: z.string().nullable(),
  ledgerParticipantId: z.string(),
})
