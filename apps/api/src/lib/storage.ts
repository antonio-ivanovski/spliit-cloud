import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { env } from './env'

let s3Client: S3Client | undefined

export function getS3Client() {
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

export function uploadsConfigured() {
  return !!(
    env.S3_UPLOAD_BUCKET &&
    env.S3_UPLOAD_KEY &&
    env.S3_UPLOAD_REGION &&
    env.S3_UPLOAD_SECRET
  )
}

export function keyFromFileUrl(fileUrl: string): string {
  let path = new URL(fileUrl).pathname.replace(/^\//, '')
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

export function publicUrlForKey(key: string): string {
  return env.S3_UPLOAD_PUBLIC_URL
    ? `${env.S3_UPLOAD_PUBLIC_URL.replace(/\/$/, '')}/${key}`
    : `https://${env.S3_UPLOAD_BUCKET}.s3.${env.S3_UPLOAD_REGION}.amazonaws.com/${key}`
}

export async function getS3Object(fileUrl: string, signal?: AbortSignal) {
  if (!uploadsConfigured()) throw new Error('Uploads are not configured')
  return getS3Client().send(
    new GetObjectCommand({
      Bucket: env.S3_UPLOAD_BUCKET,
      Key: keyFromFileUrl(fileUrl),
    }),
    signal ? { abortSignal: signal } : undefined,
  )
}
