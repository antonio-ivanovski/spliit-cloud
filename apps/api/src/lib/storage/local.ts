import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { finished } from 'node:stream/promises'

import { EncryptJWT, jwtDecrypt } from 'jose'

import { getApiBaseUrl } from '../auth/urls'
import { env } from '../env'
import {
  ObjectNotFoundError,
  type ObjectMetadata,
  type StorageDriver,
  type StoredObject,
} from './types'

const LOCAL_UPLOAD_AUDIENCE = 'spliit:local-upload'
const LOCAL_UPLOAD_TTL = '15m'

export class ObjectTooLargeError extends Error {
  readonly key: string
  readonly size: number
  readonly maxSize: number

  constructor(key: string, size: number, maxSize: number) {
    super('File exceeds the maximum upload size')
    this.name = 'ObjectTooLargeError'
    this.key = key
    this.size = size
    this.maxSize = maxSize
  }
}

function uploadTokenKey(): Uint8Array {
  const secret =
    env.BETTER_AUTH_SECRET ??
    'spliit-local-uploads-development-secret-change-me'
  return createHash('sha256').update(secret).digest()
}

async function sealUploadToken(key: string): Promise<string> {
  return new EncryptJWT({ key, aud: LOCAL_UPLOAD_AUDIENCE })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(LOCAL_UPLOAD_TTL)
    .encrypt(uploadTokenKey())
}

export async function openUploadToken(token: string): Promise<{ key: string }> {
  const { payload } = await jwtDecrypt(token, uploadTokenKey(), {
    audience: LOCAL_UPLOAD_AUDIENCE,
    clockTolerance: 5,
  })
  return { key: payload.key as string }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

type SidecarMeta = { contentType: string | null; contentLength: number }

export function createLocalDriver(uploadsDir: string): StorageDriver {
  function assertSafeKey(key: string): string {
    if (
      !key ||
      key.startsWith('/') ||
      key.startsWith('.') ||
      key.includes('\\') ||
      key.split('/').includes('..')
    ) {
      throw new Error(`Invalid object key: ${key}`)
    }
    return key
  }

  function resolveObjectPath(key: string): string {
    assertSafeKey(key)
    const root = resolve(uploadsDir)
    const path = resolve(root, key)
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error(`Object key escapes the uploads directory: ${key}`)
    }
    return path
  }

  function resolveMetaPath(key: string): string {
    assertSafeKey(key)
    return resolve(uploadsDir, '.meta', `${key}.json`)
  }

  async function readMeta(key: string): Promise<SidecarMeta | null> {
    try {
      const raw = await readFile(resolveMetaPath(key), 'utf8')
      return JSON.parse(raw) as SidecarMeta
    } catch (error) {
      if (isEnoent(error)) return null
      throw error
    }
  }

  async function writeMeta(
    key: string,
    metadata: { contentType: string | null; contentLength: number },
  ): Promise<void> {
    const metaPath = resolveMetaPath(key)
    await mkdir(dirname(metaPath), { recursive: true })
    await writeFile(metaPath, JSON.stringify(metadata), 'utf8')
  }

  async function deleteMeta(key: string): Promise<void> {
    try {
      await unlink(resolveMetaPath(key))
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
  }

  async function writeStreamWithLimit(
    stream: ReadableStream<Uint8Array>,
    path: string,
    maxSize: number,
  ): Promise<number> {
    const reader = stream.getReader()
    const sink = createWriteStream(path)
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxSize) {
          throw new ObjectTooLargeError(path, size, maxSize)
        }
        if (!sink.write(value)) await once(sink, 'drain')
      }
      sink.end()
      await finished(sink)
      return size
    } catch (error) {
      sink.destroy()
      reader.cancel().catch(() => undefined)
      throw error
    }
  }

  const driver: StorageDriver = {
    kind: 'local',
    uploadsConfigured() {
      return !!uploadsDir
    },
    async getUploadUrl({ key }) {
      const token = await sealUploadToken(key)
      return `${getApiBaseUrl()}/uploads/${key}?token=${encodeURIComponent(token)}`
    },
    async getObject(key, signal) {
      signal?.throwIfAborted()
      const path = resolveObjectPath(key)
      try {
        const bytes = await readFile(path)
        const meta = await readMeta(key)
        signal?.throwIfAborted()
        return { body: bytes, contentType: meta?.contentType ?? null }
      } catch (error) {
        if (isEnoent(error)) throw new ObjectNotFoundError(key)
        throw error
      }
    },
    async headObject(key): Promise<ObjectMetadata> {
      try {
        const fileStat = await stat(resolveObjectPath(key))
        const meta = await readMeta(key)
        return {
          contentType: meta?.contentType ?? null,
          contentLength: meta?.contentLength ?? fileStat.size,
        }
      } catch (error) {
        if (isEnoent(error)) throw new ObjectNotFoundError(key)
        throw error
      }
    },
    async copyObject(sourceKey, destinationKey) {
      const src = resolveObjectPath(sourceKey)
      const dst = resolveObjectPath(destinationKey)
      await mkdir(dirname(dst), { recursive: true })
      const [meta] = await Promise.all([
        readMeta(sourceKey),
        copyFile(src, dst),
      ])
      if (meta) await writeMeta(destinationKey, meta)
    },
    async moveObject(sourceKey, destinationKey) {
      const src = resolveObjectPath(sourceKey)
      const dst = resolveObjectPath(destinationKey)
      await mkdir(dirname(dst), { recursive: true })
      await rename(src, dst)
      const meta = await readMeta(sourceKey)
      if (meta) {
        const srcMeta = resolveMetaPath(sourceKey)
        const dstMeta = resolveMetaPath(destinationKey)
        await mkdir(dirname(dstMeta), { recursive: true })
        await rename(srcMeta, dstMeta)
      }
    },
    async deleteObject(key) {
      try {
        await unlink(resolveObjectPath(key))
      } catch (error) {
        if (!isEnoent(error)) throw error
      }
      await deleteMeta(key)
    },
    publicUrlForKey(key) {
      return `${getApiBaseUrl()}/uploads/${key}`
    },
    keyFromFileUrl(fileUrl) {
      let path = new URL(fileUrl).pathname.replace(/^\//, '')
      if (path.startsWith('uploads/')) path = path.slice('uploads/'.length)
      return path
    },
    async putObject({ key, body, contentType, maxSize }) {
      const path = resolveObjectPath(key)
      await mkdir(dirname(path), { recursive: true })
      const temporaryPath = `${path}.tmp-${randomUUID()}`
      try {
        let size: number
        if (body instanceof Uint8Array) {
          if (body.byteLength > maxSize) {
            throw new ObjectTooLargeError(key, body.byteLength, maxSize)
          }
          await writeFile(temporaryPath, body)
          size = body.byteLength
        } else {
          size = await writeStreamWithLimit(body, temporaryPath, maxSize)
        }
        await rename(temporaryPath, path)
        await writeMeta(key, { contentType, contentLength: size })
      } catch (error) {
        unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    },
  }
  return driver
}
