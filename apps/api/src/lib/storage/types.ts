/**
 * Storage driver abstraction. The S3 and local filesystem drivers implement
 * this same interface, so the minting/validation/promotion/deletion helpers in
 * `routes/upload.ts` never branch on the backend. The web client always uploads
 * by PUTting bytes to whatever URL `getUploadUrl` returns, which makes the two
 * drivers interchangeable from the tRPC layer and web client down.
 */

export interface ObjectMetadata {
  contentType: string | null
  contentLength: number
}

export interface StoredObject {
  body: unknown
  contentType: string | null
}

/** Thrown by drivers when a requested object does not exist. */
export class ObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Object not found: ${key}`)
    this.name = 'ObjectNotFoundError'
  }
}

export interface PutObjectInput {
  key: string
  body: ReadableStream<Uint8Array> | Uint8Array
  contentType: string
  /** Hard cap on bytes; local driver enforces while streaming. */
  maxSize: number
}

export interface StorageDriver {
  readonly kind: 's3' | 'local'
  uploadsConfigured(): boolean
  /** URL the web client PUTs the uploaded bytes to. */
  getUploadUrl(input: { key: string; contentType: string }): Promise<string>
  getObject(key: string, signal?: AbortSignal): Promise<StoredObject>
  headObject(key: string): Promise<ObjectMetadata>
  copyObject(sourceKey: string, destinationKey: string): Promise<void>
  moveObject(sourceKey: string, destinationKey: string): Promise<void>
  deleteObject(key: string): Promise<void>
  /** Browser-readable URL for a stored key. */
  publicUrlForKey(key: string): string
  /** Recover the key from a stored file URL. */
  keyFromFileUrl(fileUrl: string): string
  /**
   * Persist bytes for a key. Only exercised by the local upload route and the
   * S3↔local migration script; the normal S3 flow has clients PUT straight to
   * the presigned URL.
   */
  putObject(input: PutObjectInput): Promise<void>
}
