import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { getAuthFromRequest } from '../lib/auth/session'
import { env } from '../lib/env'

let s3Client: S3Client | undefined

function getS3Client() {
  s3Client ??= new S3Client({
    region: env.S3_UPLOAD_REGION,
    endpoint: env.S3_UPLOAD_ENDPOINT,
    forcePathStyle: !!env.S3_UPLOAD_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_UPLOAD_KEY ?? '',
      secretAccessKey: env.S3_UPLOAD_SECRET ?? '',
    },
  })
  return s3Client
}

function uploadsConfigured() {
  return !!(
    env.S3_UPLOAD_BUCKET &&
    env.S3_UPLOAD_KEY &&
    env.S3_UPLOAD_REGION &&
    env.S3_UPLOAD_SECRET
  )
}

function keyFromFileUrl(fileUrl: string): string {
  let path = new URL(fileUrl).pathname.replace(/^\//, '')
  // S3_UPLOAD_PUBLIC_URL may embed a path prefix (e.g. `<endpoint>/<bucket>`
  // for local MinIO/MaxIO). Strip it so the remaining string is a real object
  // key, not a URL path. CDN-style public URLs without a path prefix are
  // unaffected because their parsed pathname is empty.
  if (env.S3_UPLOAD_PUBLIC_URL) {
    const prefix = new URL(env.S3_UPLOAD_PUBLIC_URL).pathname
      .replace(/^\//, '')
      .replace(/\/$/, '')
    if (prefix && path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length + 1)
    }
  }
  return path
}

function publicUrlForKey(key: string): string {
  return env.S3_UPLOAD_PUBLIC_URL
    ? `${env.S3_UPLOAD_PUBLIC_URL.replace(/\/$/, '')}/${key}`
    : `https://${env.S3_UPLOAD_BUCKET}.s3.${env.S3_UPLOAD_REGION}.amazonaws.com/${key}`
}

export async function deleteS3Object(fileUrl: string) {
  if (!uploadsConfigured()) return

  const key = keyFromFileUrl(fileUrl)
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
  )
}

const MAX_PROFILE_IMAGE_SIZE = 512 * 1024

export function isProfileImageUrlForAccount(
  fileUrl: string,
  accountId: string,
): boolean {
  try {
    return keyFromFileUrl(fileUrl).startsWith(`profile-images/${accountId}/`)
  } catch {
    return false
  }
}

export async function createProfileImageUploadUrl(
  request: Request,
  fileSize?: number,
) {
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  return mintProfileImagePresign({ fileSize, accountId: auth.user.id })
}

/**
 * Account-bound variant used by the tRPC `uploads.profileImagePresign`
 * mutation. `protectedProcedure` has already resolved the caller, so we skip
 * the cookie round-trip and the size/env-config checks are duplicated from
 * `createProfileImageUploadUrl` to keep both entry points' behavior identical.
 */
export async function mintProfileImagePresign({
  fileSize,
  accountId,
}: {
  fileSize?: number
  accountId: string
}) {
  if (!fileSize || fileSize > MAX_PROFILE_IMAGE_SIZE) {
    return Response.json(
      { error: 'Profile image exceeds the maximum upload size' },
      { status: 400 },
    )
  }
  if (!uploadsConfigured()) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }

  const key = `profile-images/${accountId}/${randomId()}.jpg`
  const fileUrl = publicUrlForKey(key)
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: env.S3_UPLOAD_BUCKET,
      Key: key,
      ContentType: 'image/jpeg',
    }),
    { expiresIn: 60 },
  )
  return Response.json({ uploadUrl, fileUrl })
}

export async function validateProfileImageUpload(
  fileUrl: string,
  accountId: string,
) {
  if (
    !uploadsConfigured() ||
    !isProfileImageUrlForAccount(fileUrl, accountId)
  ) {
    return false
  }
  try {
    const metadata = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: env.S3_UPLOAD_BUCKET,
        Key: keyFromFileUrl(fileUrl),
      }),
    )
    return (
      metadata.ContentType === 'image/jpeg' &&
      !!metadata.ContentLength &&
      metadata.ContentLength <= MAX_PROFILE_IMAGE_SIZE
    )
  } catch {
    return false
  }
}

/**
 * Promote an uploaded document from the temporary `tmp/` prefix to a permanent
 * `documents/` prefix by copying and deleting the temp object.
 */
export async function promoteUploadedDocument(
  fileUrl: string,
): Promise<string> {
  if (!uploadsConfigured()) return fileUrl

  const key = keyFromFileUrl(fileUrl)
  if (!key.startsWith('tmp/')) return fileUrl

  const permanentKey = key.replace(/^tmp\//, 'documents/')

  const permanentObjectExists = async () => {
    try {
      await getS3Client().send(
        new HeadObjectCommand({
          Bucket: env.S3_UPLOAD_BUCKET,
          Key: permanentKey,
        }),
      )
      return true
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined
      if (status === 404) return false
      throw error
    }
  }

  // A create retry may arrive after the first request copied and deleted the
  // temporary object but before its response reached the browser.
  if (await permanentObjectExists()) {
    return publicUrlForKey(permanentKey)
  }

  try {
    await getS3Client().send(
      new CopyObjectCommand({
        Bucket: env.S3_UPLOAD_BUCKET,
        CopySource: `${env.S3_UPLOAD_BUCKET}/${encodeURIComponent(key)}`,
        Key: permanentKey,
      }),
    )
  } catch (error) {
    // Two same-request attempts may both observe a missing destination before
    // one wins the copy/delete race. If the permanent object now exists, the
    // losing promotion converges on the same URL; otherwise preserve the real
    // copy failure.
    if (await permanentObjectExists()) return publicUrlForKey(permanentKey)
    throw error
  }

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: env.S3_UPLOAD_BUCKET,
      Key: key,
    }),
  )

  return publicUrlForKey(permanentKey)
}

const MAX_UPLOAD_SIZE = 2 * 1024 ** 2

/**
 * Internal helper used by both the legacy HTTP `/uploads/presign` route (via
 * `createUploadUrl`) and the tRPC `uploads.presign` mutation. Performs the
 * post-auth work — membership check, file-size validation, S3 presign — given
 * an already-resolved account id. Returns a `Response` so the caller decides
 * how to map the status code (HTTP route maps to itself; the tRPC procedure
 * maps via `statusToTRPCCode`).
 */
async function mintUploadPresign({
  ledgerId,
  fileName,
  contentType,
  fileSize,
  accountId,
}: {
  ledgerId: string
  fileName: string
  contentType: string
  fileSize?: number
  accountId: string
}): Promise<Response> {
  if (fileSize !== undefined && fileSize > MAX_UPLOAD_SIZE) {
    return Response.json(
      { error: 'File exceeds the maximum upload size' },
      { status: 400 },
    )
  }

  if (
    !env.S3_UPLOAD_BUCKET ||
    !env.S3_UPLOAD_KEY ||
    !env.S3_UPLOAD_REGION ||
    !env.S3_UPLOAD_SECRET
  ) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }

  const ledger = await prisma.ledger.findUnique({
    where: { id: ledgerId },
    include: {
      group: {
        include: {
          members: {
            where: { accountId, status: 'ACTIVE' },
          },
        },
      },
    },
  })

  if (!ledger) {
    return Response.json({ error: 'Ledger not found' }, { status: 404 })
  }

  const isMember = ledger.group && ledger.group.members.length > 0
  if (!isMember) {
    return Response.json(
      { error: 'Not authorized to upload to this ledger' },
      { status: 403 },
    )
  }

  const [, extension = ''] = fileName.match(/(\.[^.]*)$/) ?? []
  const key = `tmp/document-${new Date().toISOString()}-${randomId()}${extension.toLowerCase()}`
  const command = new PutObjectCommand({
    Bucket: env.S3_UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: 60,
  })
  const fileUrl = publicUrlForKey(key)

  return Response.json({ uploadUrl, fileUrl, key })
}

export async function createUploadUrl(
  request: Request,
  ledgerId: string | undefined,
  fileName: string,
  contentType: string,
  fileSize?: number,
) {
  // Auth is checked first so unauthenticated callers always get 401, even
  // when the server-side uploader is not configured.
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Presign URLs are only minted for authenticated members of the target
  // ledger. Uploads without a ledgerId are not allowed because the resulting
  // document would be unowned and could be attached to any expense.
  if (!ledgerId) {
    return Response.json({ error: 'Missing ledgerId' }, { status: 400 })
  }

  return mintUploadPresign({
    ledgerId,
    fileName,
    contentType,
    fileSize,
    accountId: auth.user.id,
  })
}

/**
 * Presign a document upload for an already-authenticated account. Used by the
 * tRPC `uploads.presign` mutation — the `protectedProcedure` middleware has
 * already enforced auth, so we skip the `getAuthFromRequest` round-trip the
 * HTTP-shaped helper requires.
 */
export async function createUploadPresignForAccount({
  ledgerId,
  fileName,
  contentType,
  fileSize,
  accountId,
}: {
  ledgerId: string
  fileName: string
  contentType: string
  fileSize?: number
  accountId: string
}) {
  return mintUploadPresign({
    ledgerId,
    fileName,
    contentType,
    fileSize,
    accountId,
  })
}
