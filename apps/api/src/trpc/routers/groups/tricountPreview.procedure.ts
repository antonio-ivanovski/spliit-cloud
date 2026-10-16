import { TRPCError } from '@trpc/server'
import { Effect } from 'effect'
import { z } from 'zod'

import { extractTricountToken } from '@spliit/domain/import'

import {
  ImportPreviewLive,
  ImportPreviewService,
} from '../../../lib/import-preview-service'
import { protectedProcedure } from '../../init'
import { importPreviewOutputSchema } from '../../outputs/imports'

export const tricountPreviewProcedure = protectedProcedure
  .input(
    z.object({
      sourceUrl: z.string().min(1),
    }),
  )
  .output(importPreviewOutputSchema)
  .query(async ({ input: { sourceUrl } }) => {
    const token = extractTricountToken(sourceUrl)
    if (!token) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Not a valid Tricount share link or token',
      })
    }
    return Effect.runPromise(
      ImportPreviewService.use((service) =>
        service.previewTricountUrl(sourceUrl),
      ).pipe(Effect.provide(ImportPreviewLive)),
    )
  })
