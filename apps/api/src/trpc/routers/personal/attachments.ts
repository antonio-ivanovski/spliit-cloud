import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { randomId } from '../../../lib/api/shared'
import { toPersonalAttachment } from '../../../lib/personal/queries'
import { keyFromFileUrl, uploadsConfigured } from '../../../lib/storage'
import {
  deleteS3Object,
  promoteUploadedDocumentDetailed,
} from '../../../routes/upload'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  addPersonalAttachmentOutputSchema,
  removePersonalAttachmentOutputSchema,
} from '../../outputs/personal'

/** Max attachments per native Personal entry. No OCR/AI extraction. */
export const MAX_PERSONAL_ATTACHMENTS = 10

const attachmentInputSchema = z.object({
  url: z.string().min(1),
  fileName: z.string().min(1).max(255).optional(),
  contentType: z.string().min(1).max(255).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/**
 * Resolve an attachment URL to its permanent location. Only keys under
 * `tmp/personal/<accountId>/` (promoted to `documents/personal/<accountId>/`)
 * or `documents/personal/<accountId>/` are accepted; foreign-account and
 * foreign-prefix URLs are rejected. When uploads are unconfigured (tests,
 * integration), an already-permanent `documents/personal/...` URL is stored
 * as-is, while temp URLs are rejected because promotion cannot complete.
 *
 * `created` marks objects this call newly promoted: when the database
 * transaction that follows fails, the caller must best-effort delete the
 * promoted object so no orphan remains. A pre-existing destination (`created:
 * false`) is never deleted — another row may reference it.
 */
export async function resolvePersonalAttachmentUrl(
  accountId: string,
  fileUrl: string,
): Promise<{ url: string; created: boolean }> {
  let key: string
  try {
    key = keyFromFileUrl(fileUrl)
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid attachment URL',
    })
  }
  const tmpPrefix = `tmp/personal/${accountId}/`
  const permanentPrefix = `documents/personal/${accountId}/`
  if (!key.startsWith(tmpPrefix) && !key.startsWith(permanentPrefix)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Attachment URL is not owned by this account',
    })
  }
  if (key.startsWith(permanentPrefix)) return { url: fileUrl, created: false }
  // Temp key: promotion to `documents/personal/<accountId>/...` is required.
  if (!uploadsConfigured()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Uploads are not configured',
    })
  }
  const promoted = await promoteUploadedDocumentDetailed(fileUrl)
  const promotedKey = keyFromFileUrl(promoted.url)
  if (!promotedKey.startsWith(permanentPrefix)) {
    if (promoted.created) {
      await deletePersonalAttachmentObjectsBestEffort([promoted.url])
    }
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Attachment promotion failed',
    })
  }
  return promoted
}

/** Best-effort S3 cleanup after the database commit. Never throws. */
export async function deletePersonalAttachmentObjectsBestEffort(
  fileUrls: string[],
): Promise<void> {
  for (const fileUrl of fileUrls) {
    try {
      await deleteS3Object(fileUrl)
    } catch (error) {
      console.warn('[personal-attachments] failed to delete S3 object:', error)
    }
  }
}

export const personalAttachmentsRouter = createTRPCRouter({
  add: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().min(1),
        expectedVersion: z.number().int().positive().optional(),
        attachment: attachmentInputSchema,
      }),
    )
    .output(addPersonalAttachmentOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await prisma.personalTransaction.findFirst({
        where: { id: input.transactionId, accountId },
        select: { id: true, source: true },
      })
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Personal entry not found',
        })
      }
      if (row.source !== 'PERSONAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Shared entries do not accept attachments',
        })
      }

      // Promote before the insert so a failed promotion never leaves a row
      // pointing at a temp key. When the transaction below fails (cap or
      // version conflict), a newly promoted object is removed again so no
      // orphan remains; pre-existing destinations are never deleted.
      const resolved = await resolvePersonalAttachmentUrl(
        accountId,
        input.attachment.url,
      )

      try {
        const created = await prisma.$transaction(async (tx) => {
          // Serialize concurrent adds on the parent row: the lock is held
          // until commit, so the cap count below cannot race. The version
          // bump keeps its CAS semantics — a stale `expectedVersion` still
          // conflicts without inserting.
          await tx.$queryRaw`SELECT id FROM "PersonalTransaction" WHERE id = ${row.id} AND "accountId" = ${accountId} FOR UPDATE`
          const count = await tx.personalAttachment.count({
            where: { personalTransactionId: row.id, accountId },
          })
          if (count >= MAX_PERSONAL_ATTACHMENTS) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'This entry already has the maximum number of attachments',
            })
          }
          const bumped = await tx.personalTransaction.updateMany({
            where: {
              id: row.id,
              accountId,
              source: 'PERSONAL',
              ...(input.expectedVersion
                ? { version: input.expectedVersion }
                : {}),
            },
            data: { version: { increment: 1 } },
          })
          if (bumped.count === 0) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'This entry changed. Refresh and try again.',
            })
          }
          return tx.personalAttachment.create({
            data: {
              id: randomId(),
              personalTransactionId: row.id,
              accountId,
              url: resolved.url,
              fileName: input.attachment.fileName ?? null,
              contentType: input.attachment.contentType ?? null,
              width: input.attachment.width ?? null,
              height: input.attachment.height ?? null,
            },
          })
        })
        return toPersonalAttachment(created)
      } catch (error) {
        if (resolved.created) {
          await deletePersonalAttachmentObjectsBestEffort([resolved.url])
        }
        throw error
      }
    }),

  remove: protectedProcedure
    .input(
      z.object({
        transactionId: z.string().min(1),
        attachmentId: z.string().min(1),
        expectedVersion: z.number().int().positive().optional(),
      }),
    )
    .output(removePersonalAttachmentOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const accountId = ctx.auth.user.id
      const row = await prisma.personalTransaction.findFirst({
        where: { id: input.transactionId, accountId },
        select: { id: true, source: true },
      })
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Personal entry not found',
        })
      }
      if (row.source !== 'PERSONAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Shared entries do not accept attachments',
        })
      }
      const attachment = await prisma.personalAttachment.findFirst({
        where: {
          id: input.attachmentId,
          personalTransactionId: input.transactionId,
          accountId,
        },
      })
      if (!attachment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Attachment not found',
        })
      }

      await prisma.$transaction(async (tx) => {
        const bumped = await tx.personalTransaction.updateMany({
          where: {
            id: row.id,
            accountId,
            source: 'PERSONAL',
            ...(input.expectedVersion
              ? { version: input.expectedVersion }
              : {}),
          },
          data: { version: { increment: 1 } },
        })
        if (bumped.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This entry changed. Refresh and try again.',
          })
        }
        await tx.personalAttachment.delete({ where: { id: attachment.id } })
      })

      // Only delete the S3 object when no other attachment row still
      // references the URL (the same file can be attached twice). The removed
      // row is excluded so the check is correct even before the cascade is
      // visible.
      const remaining = await prisma.personalAttachment.count({
        where: {
          url: attachment.url,
          NOT: { id: attachment.id },
        },
      })
      if (remaining === 0) {
        await deletePersonalAttachmentObjectsBestEffort([attachment.url])
      }
      return { ok: true as const }
    }),
})
