import {
  DeleteObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
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

export async function deleteS3Object(fileUrl: string) {
  if (
    !env.S3_UPLOAD_BUCKET ||
    !env.S3_UPLOAD_KEY ||
    !env.S3_UPLOAD_REGION ||
    !env.S3_UPLOAD_SECRET
  )
    return

  const key = new URL(fileUrl).pathname.replace(/^\//, '')
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
  )
}

export async function markS3ObjectAsOwned(fileUrl: string) {
  if (
    !env.S3_UPLOAD_BUCKET ||
    !env.S3_UPLOAD_KEY ||
    !env.S3_UPLOAD_REGION ||
    !env.S3_UPLOAD_SECRET
  )
    return

  const key = new URL(fileUrl).pathname.replace(/^\//, '')
  await getS3Client().send(
    new PutObjectTaggingCommand({
      Bucket: env.S3_UPLOAD_BUCKET,
      Key: key,
      Tagging: { TagSet: [{ Key: 'status', Value: 'owned' }] },
    }),
  )
}

const MAX_UPLOAD_SIZE = 2 * 1024 ** 2

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
            where: { accountId: auth.user.id, status: 'ACTIVE' },
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
  const key = `document-${new Date().toISOString()}-${randomId()}${extension.toLowerCase()}`
  const command = new PutObjectCommand({
    Bucket: env.S3_UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
    Tagging: 'status=unowned',
  })
  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: 60,
  })
  const fileUrl = env.S3_UPLOAD_PUBLIC_URL
    ? `${env.S3_UPLOAD_PUBLIC_URL.replace(/\/$/, '')}/${key}`
    : `https://${env.S3_UPLOAD_BUCKET}.s3.${env.S3_UPLOAD_REGION}.amazonaws.com/${key}`

  return Response.json({ uploadUrl, fileUrl, key })
}
