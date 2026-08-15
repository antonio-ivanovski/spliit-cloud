export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new Error('Unsupported object storage response body')
}

/**
 * Collect the bytes of a driver object body. Handles every body shape the S3
 * SDK can return (byte array, `transformToByteArray`, async iterable, web
 * stream) as well as the plain `Uint8Array` the local driver produces.
 */
export async function objectBodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body) throw new Error('Object has no storage body')
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return toBytes(body)
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return toBytes(await body.transformToByteArray())
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of body as AsyncIterable<unknown>) {
      const bytes = toBytes(chunk)
      chunks.push(bytes)
      total += bytes.byteLength
    }
    return concatChunks(chunks, total)
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
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        total += value.byteLength
      }
    } finally {
      reader.releaseLock()
    }
    return concatChunks(chunks, total)
  }

  throw new Error('Unsupported object storage response body')
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
