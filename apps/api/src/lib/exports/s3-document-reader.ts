import { MAX_EXPENSE_DOCUMENT_SIZE } from '@spliit/domain'

import { getS3Object } from '../storage'
import type { ExportDocumentReader } from './types'

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new Error('Unsupported object storage response body')
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Export cancelled')
}

function ensureDocumentSize(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_EXPENSE_DOCUMENT_SIZE) {
    throw new Error('Document exceeds the maximum upload size')
  }
  return bytes
}

async function readBody(
  body: unknown,
  signal: AbortSignal,
): Promise<Uint8Array> {
  assertNotAborted(signal)
  if (!body) throw new Error('Document has no object storage body')
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return ensureDocumentSize(toBytes(body))
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    const bytes = toBytes(await body.transformToByteArray())
    assertNotAborted(signal)
    return ensureDocumentSize(bytes)
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    const chunks: Uint8Array[] = []
    let total = 0
    const iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    const onAbort = () => {
      try {
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      } catch {
        // The pending object stream will reject through the S3 abort signal.
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (true) {
        assertNotAborted(signal)
        const next = await iterator.next()
        if (next.done) break
        const bytes = toBytes(next.value)
        total += bytes.byteLength
        if (total > MAX_EXPENSE_DOCUMENT_SIZE) {
          throw new Error('Document exceeds the maximum upload size')
        }
        chunks.push(bytes)
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'getReader' in body &&
    typeof body.getReader === 'function'
  ) {
    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const chunks: Uint8Array[] = []
    let total = 0
    const onAbort = () => {
      void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (true) {
        assertNotAborted(signal)
        const next = await reader.read()
        if (next.done) break
        const bytes = toBytes(next.value)
        total += bytes.byteLength
        if (total > MAX_EXPENSE_DOCUMENT_SIZE) {
          throw new Error('Document exceeds the maximum upload size')
        }
        chunks.push(bytes)
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  throw new Error('Unsupported object storage response body')
}

export const s3ExportDocumentReader: ExportDocumentReader = {
  async read(document, signal) {
    const response = await getS3Object(document.url, signal)
    return readBody(response.Body, signal)
  },
}
