import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { env } from '../lib/env'
import { createLocalDriver } from '../lib/storage/local'
import { getUploadedObject, putUploadedObject } from './uploads'

let dir: string
let originalDriver: string | undefined
let originalDir: string | undefined

const app = new Hono()
app.put('/uploads/:key{.+}', putUploadedObject)
app.get('/uploads/:key{.+}', getUploadedObject)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spliit-uploads-route-'))
  originalDriver = env.UPLOADS_DRIVER
  originalDir = env.UPLOADS_DIR
  env.UPLOADS_DRIVER = 'local'
  env.UPLOADS_DIR = dir
})

afterEach(async () => {
  env.UPLOADS_DRIVER = originalDriver
  env.UPLOADS_DIR = originalDir
  await rm(dir, { recursive: true, force: true })
})

async function mintUploadUrl(key: string) {
  return createLocalDriver(dir).getUploadUrl({
    key,
    contentType: 'image/jpeg',
    maxSize: 1024,
  })
}

describe('/uploads PUT and GET routes', () => {
  it('stores a PUT body and serves it back', async () => {
    const key = 'tmp/document-1.jpg'
    const uploadUrl = await mintUploadUrl(key)
    const body = new TextEncoder().encode('jpeg-bytes')

    const putResponse = await app.request(uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/jpeg' },
    })
    expect(putResponse.status).toBe(204)

    const getResponse = await app.request(`http://localhost/uploads/${key}`, {
      method: 'GET',
    })
    expect(getResponse.status).toBe(200)
    expect(await getResponse.arrayBuffer()).toEqual(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    )
    expect(getResponse.headers.get('Content-Type')).toBe('image/jpeg')
    expect(getResponse.headers.get('Cache-Control')).toContain('immutable')
  })

  it('rejects a PUT without a token', async () => {
    const response = await app.request(
      'http://localhost/uploads/tmp/document-1.jpg',
      { method: 'PUT', body: new TextEncoder().encode('x') },
    )
    expect(response.status).toBe(401)
  })

  it('rejects a PUT whose token names a different key', async () => {
    const uploadUrl = await mintUploadUrl('tmp/allowed.jpg')
    const otherUrl = uploadUrl.replace('tmp/allowed.jpg', 'tmp/other.jpg')
    const response = await app.request(otherUrl, {
      method: 'PUT',
      body: new TextEncoder().encode('x'),
    })
    expect(response.status).toBe(401)
  })

  it('rejects a PUT beyond the sealed size cap', async () => {
    const uploadUrl = await mintUploadUrl('tmp/big.jpg')
    const response = await app.request(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(2048),
    })
    expect(response.status).toBe(413)
  })

  it('returns 404 for a missing object', async () => {
    const response = await app.request(
      'http://localhost/uploads/documents/missing.jpg',
      { method: 'GET' },
    )
    expect(response.status).toBe(404)
  })

  it('is inactive when the S3 driver is active', async () => {
    env.UPLOADS_DRIVER = 's3'
    const putResponse = await app.request(
      'http://localhost/uploads/tmp/x.jpg',
      { method: 'PUT', body: new TextEncoder().encode('x') },
    )
    expect(putResponse.status).toBe(404)
    const getResponse = await app.request(
      'http://localhost/uploads/documents/x.jpg',
      { method: 'GET' },
    )
    expect(getResponse.status).toBe(404)
  })
})
