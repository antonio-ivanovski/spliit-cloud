import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { spliitGroupExportManifestSchema } from '@spliit/domain'

import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import {
  importCloudGroup,
  prepareCloudImport,
  type CloudImportInput,
} from '../../../lib/api/import-cloud'
import { enqueueBudgetEvaluation } from '../../../lib/budgets/enqueue'
import { deleteS3Object } from '../../../routes/upload'
import { protectedProcedure } from '../../init'
import { importCloudBundleOutputSchema } from '../../outputs/imports'

const participantMappingSchema = z.discriminatedUnion('mode', [
  z.object({
    sourceParticipantId: z.string().min(1),
    sourceName: z.string().trim().min(1).max(120),
    mode: z.literal('LINK_ACCOUNT'),
    linkedAccountId: z.string().min(1),
  }),
  z.object({
    sourceParticipantId: z.string().min(1),
    sourceName: z.string().trim().min(1).max(120),
    mode: z.literal('INVITE_BY_EMAIL'),
    email: z.email(),
  }),
  z.object({
    sourceParticipantId: z.string().min(1),
    sourceName: z.string().trim().min(1).max(120),
    mode: z.literal('INVITE_CONTACT'),
    email: z.email(),
  }),
  z.object({
    sourceParticipantId: z.string().min(1),
    sourceName: z.string().trim().min(1).max(120),
    mode: z.literal('INVITE_BY_LINK'),
  }),
  z.object({
    sourceParticipantId: z.string().min(1),
    sourceName: z.string().trim().min(1).max(120),
    mode: z.literal('UNLINKED_PARTICIPANT'),
  }),
])

const cloudGroupFormValuesSchema = z.object({
  name: z.string().min(2).max(50),
  information: z.string().nullable().optional(),
  currency: z.string().min(1).max(5),
  currencyCode: z
    .union([z.string().min(3).max(4).nullish(), z.literal('')])
    .optional(),
})

const cloudImportInputSchema = z.object({
  requestId: createRequestIdSchema,
  manifest: spliitGroupExportManifestSchema,
  groupFormValues: cloudGroupFormValuesSchema,
  archived: z.boolean(),
  participants: z.array(participantMappingSchema),
  stagedDocuments: z.object({
    sessionId: z.uuid(),
    documents: z.array(
      z.object({
        sourceDocumentId: z.string().min(1),
        stagedToken: z.string().min(1),
      }),
    ),
  }),
  skippedDocumentIds: z.array(z.string().min(1)),
  acknowledgedIssues: z.boolean(),
  groupPreference: z
    .object({
      starred: z.boolean(),
      hidden: z.boolean(),
      defaultSplit: z
        .object({
          splitMode: z.enum([
            'EVENLY',
            'BY_SHARES',
            'BY_PERCENTAGE',
            'BY_AMOUNT',
          ]),
          paidFor: z.array(
            z.object({
              participantId: z.string().min(1),
              shares: z.number().int(),
            }),
          ),
        })
        .nullable(),
    })
    .optional(),
})

export const importCloudBundleProcedure = protectedProcedure
  .input(cloudImportInputSchema)
  .output(importCloudBundleOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const cloudInput = input as CloudImportInput
    let prepared: Awaited<ReturnType<typeof prepareCloudImport>> | undefined
    let committed = false

    const cleanupPreparedFiles = async () => {
      if (!prepared) return
      await Promise.allSettled(
        [
          ...prepared.promotedDocumentUrls,
          ...[...prepared.documents.values()].map(
            (document) => document.temporaryUrl,
          ),
        ].map((url) => deleteS3Object(url)),
      )
    }

    try {
      const { value: result, replayed } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.cloudImport,
        requestId: input.requestId,
        input: { ...input, requestId: undefined },
        prepare: async () => {
          prepared = await prepareCloudImport(cloudInput, ctx.auth.user.id)
          return prepared
        },
        execute: (tx, value) =>
          importCloudGroup(
            cloudInput,
            { accountId: ctx.auth.user.id, email: ctx.auth.user.email },
            { tx, prepared: value },
          ),
      })
      committed = true
      if (replayed) {
        // Preparation happens before the idempotency row is claimed. A
        // concurrent request can therefore stage a second set of objects and
        // then lose the race to the already-committed result; clean those
        // objects instead of leaking them in temporary/permanent storage.
        await cleanupPreparedFiles()
      } else if (prepared) {
        await Promise.allSettled(
          [...prepared.documents.values()].map((document) =>
            deleteS3Object(document.temporaryUrl),
          ),
        )
        if (result.importedExpenses > 0) {
          await enqueueBudgetEvaluation(result.groupId)
        }
      }
      const { promotedDocumentUrls: _promoted, ...response } = result
      return response
    } catch (error) {
      if (!committed) await cleanupPreparedFiles()
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Cloud import failed',
      })
    }
  })
