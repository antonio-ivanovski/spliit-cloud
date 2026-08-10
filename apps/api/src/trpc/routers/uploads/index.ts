import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import {
  createUploadPresignForAccount,
  mintImportDocumentPresign,
  mintProfileImagePresign,
} from '../../../routes/upload'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  profileImagePresignOutputSchema,
  importDocumentPresignOutputSchema,
  uploadPresignOutputSchema,
} from '../../outputs/uploads'

const presignInput = z.object({
  ledgerId: z.string().min(1),
  fileName: z.string().min(1).default('document'),
  contentType: z
    .string()
    .min(1)
    .describe('MIME type for the presigned PUT (e.g. image/jpeg).')
    .default('application/octet-stream'),
  fileSize: z
    .number()
    .int()
    .positive()
    .describe('Bytes. Validated against the S3/R2 max upload size.')
    .optional(),
})

const profileImageInput = z.object({
  fileSize: z
    .number()
    .int()
    .positive()
    .describe('Bytes. Validated against the S3/R2 max upload size.')
    .optional(),
})

/**
 * Upload presign router. Wraps the S3 presign helpers from `routes/upload.ts`
 * as tRPC mutations so the same flow is exposed through the unified `/trpc/*`
 * API surface and documented in the auto-generated OpenAPI spec. The
 * HTTP-shaped helpers (`createUploadUrl`, `createProfileImageUploadUrl`) are
 * kept around for their unit tests; the tRPC mutations use account-bound
 * helpers instead because `protectedProcedure` has already resolved the
 * caller's account, so we skip the redundant cookie round-trip.
 */
export const uploadsRouter = createTRPCRouter({
  importDocumentPresign: protectedProcedure
    .input(
      z.object({
        sessionId: z.uuid(),
        sourceToken: z.string().min(1),
        fileSize: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .output(importDocumentPresignOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const response = await mintImportDocumentPresign({
        ...input,
        accountId: ctx.auth.user.id,
      })
      return (await readPresignResponse(
        response,
        'Import document presign failed',
      )) as { uploadUrl: string; stagedToken: string }
    }),

  /**
   * Get a presigned PUT URL for an expense document upload. The client uploads
   * directly to S3/R2, then passes the returned `fileUrl` in the expense's
   * `documents` array.
   */
  presign: protectedProcedure
    .input(presignInput)
    .output(uploadPresignOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const response = await createUploadPresignForAccount({
        ledgerId: input.ledgerId,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSize: input.fileSize,
        accountId: ctx.auth.user.id,
      })
      const body = await readPresignResponse(response, 'Upload presign failed')
      return body as unknown as {
        uploadUrl: string
        fileUrl: string
        key: string
      }
    }),

  /**
   * Get a presigned PUT URL for a profile image upload. Pass the returned
   * `fileUrl` to `account.setProfileImage`.
   */
  profileImagePresign: protectedProcedure
    .input(profileImageInput)
    .output(profileImagePresignOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const response = await mintProfileImagePresign({
        fileSize: input.fileSize,
        accountId: ctx.auth.user.id,
      })
      const body = await readPresignResponse(
        response,
        'Profile image presign failed',
      )
      return body as unknown as { uploadUrl: string; fileUrl: string }
    }),
})

type PresignResponseBody = {
  uploadUrl?: string
  fileUrl?: string
  key?: string
  stagedToken?: string
}

async function readPresignResponse(
  response: Response,
  fallbackMessage: string,
): Promise<PresignResponseBody & { error?: string }> {
  const status = response.status
  const body = (await response
    .json()
    .catch(() => ({}))) as PresignResponseBody & {
    error?: string
  }
  if (status !== 200) {
    throw new TRPCError({
      code: statusToTRPCCode(status),
      message: body.error ?? fallbackMessage,
    })
  }
  return body
}

function statusToTRPCCode(status: number) {
  if (status === 401) return 'UNAUTHORIZED' as const
  if (status === 403) return 'FORBIDDEN' as const
  if (status === 404) return 'NOT_FOUND' as const
  if (status === 413 || status === 400) return 'BAD_REQUEST' as const
  if (status === 503) return 'SERVICE_UNAVAILABLE' as const
  return 'INTERNAL_SERVER_ERROR' as const
}
