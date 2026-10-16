import { TRPCError } from '@trpc/server'
import { Effect } from 'effect'
import { z } from 'zod'

import { extractSpliitGroupIdFromUrl } from '@spliit/domain/import'

import {
  ImportPreviewLive,
  ImportPreviewService,
} from '../../../lib/import-preview-service'
import { protectedProcedure } from '../../init'
import { importPreviewOutputSchema } from '../../outputs/imports'

export const previewFromUrlProcedure = protectedProcedure
  .input(
    z.object({
      sourceUrl: z.string().min(1),
    }),
  )
  .output(importPreviewOutputSchema)
  .query(async ({ input: { sourceUrl } }) => {
    const sourceGroupId = extractSpliitGroupIdFromUrl(sourceUrl)
    if (!sourceGroupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Not a valid spliit.app group URL',
      })
    }
    return Effect.runPromise(
      ImportPreviewService.use((service) =>
        service.previewSpliitUrl(sourceUrl),
      ).pipe(Effect.provide(ImportPreviewLive)),
    )
  })
