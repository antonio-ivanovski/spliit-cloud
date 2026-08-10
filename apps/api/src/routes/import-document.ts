import { getAuthFromRequest } from '../lib/auth/session'
import {
  fetchSourceDocument,
  openSourceDocumentClaims,
} from '../lib/import-documents'

export async function proxyImportDocument(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const token = request.headers.get('x-import-document-token')
  if (!token) return Response.json({ error: 'Missing token' }, { status: 400 })
  try {
    const claims = await openSourceDocumentClaims(token)
    if (claims.accountId !== auth.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const image = await fetchSourceDocument(claims.sourceUrl)
    return new Response(Uint8Array.from(image.bytes).buffer, {
      headers: {
        'content-type': image.contentType,
        'content-length': String(image.bytes.byteLength),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not fetch source document',
      },
      { status: 400 },
    )
  }
}
