import { create as contentDisposition } from 'content-disposition'

import { prisma } from '@spliit/db'
import { accountExportSelectionSchema } from '@spliit/domain'

import { getApplicationAuthFromRequest } from '../lib/auth/session'
import {
  createAccountExportArtifact,
  InvalidAccountExportSelectionError,
  loadAccountExportSource,
  s3ExportDocumentReader,
} from '../lib/exports'

async function readSelection(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return request.json()

  const form = await request.formData()
  const raw = form.get('selection')
  if (typeof raw !== 'string') {
    throw new InvalidAccountExportSelectionError('Missing export selection.')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new InvalidAccountExportSelectionError('Invalid export selection.')
  }
}

export async function exportAccountBundle(request: Request) {
  const { auth, response } = await getApplicationAuthFromRequest(request)
  if (response) return response

  let selection
  try {
    selection = accountExportSelectionSchema.parse(await readSelection(request))
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Invalid export selection',
      },
      { status: 400 },
    )
  }

  try {
    const source = await prisma.$transaction(
      (transaction) =>
        loadAccountExportSource(auth.user.id, selection, transaction),
      { isolationLevel: 'RepeatableRead' },
    )
    const artifact = createAccountExportArtifact(source, {
      exportedAt: new Date(),
      documentReader: s3ExportDocumentReader,
      includeDocuments: selection.includeDocuments,
      includeAccountPreferences: selection.includeAccountPreferences,
      includeGroupPreferences: selection.includeGroupPreferences,
      signal: request.signal,
    })
    return new Response(artifact.body, {
      headers: {
        'content-type': artifact.mediaType,
        'content-disposition': contentDisposition(artifact.fileName),
      },
    })
  } catch (error) {
    if (error instanceof InvalidAccountExportSelectionError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
