import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { env } from '../env'
import { objectBodyToBytes } from './bytes'
import {
  ObjectNotFoundError,
  type StorageDriver,
  type StoredObject,
} from './types'

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

type S3SendOptions = { abortSignal: AbortSignal }

function sendOptions(signal?: AbortSignal): S3SendOptions | undefined {
  return signal ? { abortSignal: signal } : undefined
}

function httpStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && '$metadata' in error
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode
    : undefined
}

function asS3ObjectResponse(response: unknown): StoredObject {
  const value = response as {
    Body?: unknown
    ContentType?: string
  }
  return { body: value.Body, contentType: value.ContentType ?? null }
}

export function createS3Driver(): StorageDriver {
  const driver: StorageDriver = {
    kind: 's3',
    uploadsConfigured() {
      return !!(
        env.S3_UPLOAD_BUCKET &&
        env.S3_UPLOAD_KEY &&
        env.S3_UPLOAD_REGION &&
        env.S3_UPLOAD_SECRET
      )
    },
    async getUploadUrl({ key, contentType }) {
      return getSignedUrl(
        getS3Client(),
        new PutObjectCommand({
          Bucket: env.S3_UPLOAD_BUCKET,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: 60 },
      )
    },
    async getObject(key, signal) {
      try {
        const response = await getS3Client().send(
          new GetObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
          sendOptions(signal),
        )
        return asS3ObjectResponse(response)
      } catch (error) {
        if (httpStatus(error) === 404) throw new ObjectNotFoundError(key)
        throw error
      }
    },
    async headObject(key) {
      try {
        const response = await getS3Client().send(
          new HeadObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
        )
        return {
          contentType: response.ContentType ?? null,
          contentLength: response.ContentLength ?? 0,
        }
      } catch (error) {
        if (httpStatus(error) === 404) throw new ObjectNotFoundError(key)
        throw error
      }
    },
    async copyObject(sourceKey, destinationKey) {
      await getS3Client().send(
        new CopyObjectCommand({
          Bucket: env.S3_UPLOAD_BUCKET,
          CopySource: `${env.S3_UPLOAD_BUCKET}/${encodeURIComponent(sourceKey)}`,
          Key: destinationKey,
        }),
      )
    },
    async moveObject(sourceKey, destinationKey) {
      await driver.copyObject(sourceKey, destinationKey)
      await driver.deleteObject(sourceKey)
    },
    async deleteObject(key) {
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
      )
    },
    publicUrlForKey(key) {
      return env.S3_UPLOAD_PUBLIC_URL
        ? `${env.S3_UPLOAD_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : `https://${env.S3_UPLOAD_BUCKET}.s3.${env.S3_UPLOAD_REGION}.amazonaws.com/${key}`
    },
    keyFromFileUrl(fileUrl) {
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
    },
    async putObject({ key, body, contentType }) {
      const bytes =
        body instanceof Uint8Array ? body : await objectBodyToBytes(body)
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: env.S3_UPLOAD_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      )
    },
  }
  return driver
}
