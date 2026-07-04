/**
 * Tiny MaxIO (S3-compatible) client used by integration tests to inspect and
 * clear the local object store. MaxIO runs as part of `bun dev:up` on
 * http://localhost:9000 (S3 API + admin UI). The bucket is configured in
 * apps/api/.env.integration and matches MAXIO_DEFAULT_BUCKETS.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../lib/env'

const MAXIO_BASE = process.env.MAXIO_URL ?? 'http://localhost:9000'

let client: S3Client | undefined

function getClient(): S3Client {
  if (client) return client
  client = new S3Client({
    region: env.S3_UPLOAD_REGION,
    endpoint: env.S3_UPLOAD_ENDPOINT,
    forcePathStyle: !!env.S3_UPLOAD_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_UPLOAD_KEY ?? '',
      secretAccessKey: env.S3_UPLOAD_SECRET ?? '',
    },
  })
  return client
}

/** Probe MaxIO's S3 API. Returns true if the bucket is reachable. */
export async function probeMaxIO(): Promise<boolean> {
  if (!env.S3_UPLOAD_BUCKET) return false
  try {
    await getClient().send(
      new ListObjectsV2Command({
        Bucket: env.S3_UPLOAD_BUCKET,
        MaxKeys: 1,
      }),
    )
    return true
  } catch {
    return false
  }
}

/** List object keys in the test bucket, optionally filtered by prefix. */
export async function listObjects(prefix?: string): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined
  do {
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: env.S3_UPLOAD_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key)
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)
  return keys
}

/** Returns true if the given object key exists in the test bucket. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
    )
    return true
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode
    if (status === 404) return false
    throw err
  }
}

/** Fetches the bytes of an object. Returns null if it does not exist. */
export async function getObjectBody(key: string): Promise<string | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
    )
    if (!res.Body) return null
    return await res.Body.transformToString()
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode
    if (status === 404) return null
    throw err
  }
}

/** Delete every object in the test bucket. Safe to call between test runs. */
export async function clearBucket(): Promise<void> {
  const keys = await listObjects()
  await Promise.all(
    keys.map((key) =>
      getClient().send(
        new DeleteObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
      ),
    ),
  )
}

/** Convenience: returns true if no objects exist with the given prefix. */
export async function prefixIsEmpty(prefix: string): Promise<boolean> {
  const keys = await listObjects(prefix)
  return keys.length === 0
}

/** Base URL the API emits for public file URLs (matches env.S3_UPLOAD_PUBLIC_URL). */
export function maxioPublicBase(): string {
  return MAXIO_BASE
}
