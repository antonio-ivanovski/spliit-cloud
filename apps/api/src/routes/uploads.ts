import type { Context } from 'hono'

import { logServerError } from '../lib/logging'
import {
  getStorageDriver,
  ObjectNotFoundError,
  objectBodyToBytes,
} from '../lib/storage'
import { ObjectTooLargeError, openUploadToken } from '../lib/storage/local'

/**
 * Accept the bytes the web client PUTs to the `/uploads/<key>` URL the local
 * driver mints. The driver seals the target key, content type, and size cap
 * into a short-lived signed token; this handler verifies the token before
 * streaming the request body to disk. Only active in local mode — in S3 mode
 * the client PUTs straight to the presigned object-store URL instead.
 */
export async function putUploadedObject(c: Context): Promise<Response> {
  const driver = getStorageDriver()
  if (driver.kind !== 'local' || !driver.uploadsConfigured()) {
    return c.json({ error: 'Not found' }, 404)
  }

  const token = c.req.query('token')
  const requestedKey = c.req.param('key') ?? ''
  if (!token) {
    return c.json({ error: 'Unauthenticated' }, 401)
  }

  let claims
  try {
    claims = await openUploadToken(token)
  } catch {
    return c.json({ error: 'Unauthenticated' }, 401)
  }
  if (claims.key !== requestedKey) {
    return c.json({ error: 'Unauthenticated' }, 401)
  }

  try {
    await driver.putObject({
      key: claims.key,
      body: c.req.raw.body ?? new Uint8Array(0),
      contentType: claims.contentType,
      maxSize: claims.maxSize,
    })
  } catch (error) {
    if (error instanceof ObjectTooLargeError) {
      return c.json({ error: 'File exceeds the maximum upload size' }, 413)
    }
    logServerError('api.upload.put', error, { key: claims.key })
    return c.json({ error: 'Upload failed' }, 500)
  }

  return c.body(null, 204)
}

/**
 * Serve a stored local object at its public URL. Keys are unguessable random
 * identifiers, so unauthenticated reads mirror S3/R2 public-bucket behavior.
 * The local driver's path guards reject traversal attempts.
 */
export async function getUploadedObject(c: Context): Promise<Response> {
  const driver = getStorageDriver()
  if (driver.kind !== 'local' || !driver.uploadsConfigured()) {
    return c.notFound()
  }

  const key = c.req.param('key') ?? ''
  try {
    const { body, contentType } = await driver.getObject(key)
    const bytes = new Uint8Array(await objectBodyToBytes(body))
    return new Response(bytes, {
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return c.notFound()
    logServerError('api.upload.get', error, { key })
    return c.json({ error: 'Not found' }, 500)
  }
}
