import { create as contentDisposition } from 'content-disposition'

import { prisma } from '@spliit/db'

import { getAuthFromRequest } from '../lib/auth/session'
import {
  createGroupExportArtifact,
  loadGroupExportSource,
  s3ExportDocumentReader,
} from '../lib/exports'

export async function exportGroupBundle(request: Request, groupId: string) {
  const auth = await getAuthFromRequest(request)
  if (!auth) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: auth.user.id } },
    select: { status: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const group = await prisma.$transaction(
    (transaction) => loadGroupExportSource(groupId, transaction),
    { isolationLevel: 'RepeatableRead' },
  )
  if (!group || !group.ledger) {
    return Response.json({ error: 'Invalid group ID' }, { status: 404 })
  }

  const artifact = createGroupExportArtifact(group, {
    exportedAt: new Date(),
    documentReader: s3ExportDocumentReader,
    signal: request.signal,
  })
  return new Response(artifact.body, {
    headers: {
      'content-type': artifact.mediaType,
      'content-disposition': contentDisposition(artifact.fileName),
    },
  })
}
