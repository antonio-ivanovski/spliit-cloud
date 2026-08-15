import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { objectBodyToBytes } from './bytes'
import { createLocalDriver, openUploadToken } from './local'
import { ObjectNotFoundError } from './types'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spliit-local-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function createDriver(uploadsDir = dir) {
  return createLocalDriver(uploadsDir)
}

async function readBody(
  driver: ReturnType<typeof createLocalDriver>,
  key: string,
) {
  const { body } = await driver.getObject(key)
  return new TextDecoder().decode(await objectBodyToBytes(body))
}

describe('createLocalDriver', () => {
  it('reports configured only when a directory is set', () => {
    expect(createLocalDriver('/some/dir').uploadsConfigured()).toBe(true)
    expect(createLocalDriver('').uploadsConfigured()).toBe(false)
  })

  it('round-trips a stored object with its content type and length', async () => {
    const driver = createDriver()
    const body = new TextEncoder().encode('receipt contents')
    await driver.putObject({
      key: 'documents/expense/1.jpg',
      body,
      contentType: 'image/jpeg',
      maxSize: 1024,
    })

    expect(await readBody(driver, 'documents/expense/1.jpg')).toBe(
      'receipt contents',
    )
    const metadata = await driver.headObject('documents/expense/1.jpg')
    expect(metadata.contentLength).toBe(body.byteLength)
    expect(metadata.contentType).toBe('image/jpeg')
  })

  it('stores the exact bytes handed to putObject', async () => {
    const driver = createDriver()
    const payload = new TextEncoder().encode('hello local uploads')
    await driver.putObject({
      key: 'tmp/upload.bin',
      body: payload,
      contentType: 'application/octet-stream',
      maxSize: 1024,
    })
    expect(new Uint8Array(await readFile(join(dir, 'tmp/upload.bin')))).toEqual(
      payload,
    )
  })

  it('rejects bytes beyond the size cap', async () => {
    const driver = createDriver()
    await expect(
      driver.putObject({
        key: 'tmp/big.jpg',
        body: new Uint8Array(2048),
        contentType: 'image/jpeg',
        maxSize: 1024,
      }),
    ).rejects.toThrow('maximum upload size')
  })

  it('rejects a streamed body beyond the size cap and cleans the temp file', async () => {
    const driver = createDriver()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(600))
        controller.enqueue(new Uint8Array(600))
        controller.close()
      },
    })
    await expect(
      driver.putObject({
        key: 'tmp/stream.jpg',
        body: stream,
        contentType: 'image/jpeg',
        maxSize: 1000,
      }),
    ).rejects.toThrow('maximum upload size')
    const leftovers = await readdir(join(dir, 'tmp'))
    expect(leftovers.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('deletes an object and its metadata', async () => {
    const driver = createDriver()
    await driver.putObject({
      key: 'documents/delete-me.jpg',
      body: new TextEncoder().encode('x'),
      contentType: 'image/jpeg',
      maxSize: 1024,
    })
    await driver.deleteObject('documents/delete-me.jpg')
    await expect(driver.getObject('documents/delete-me.jpg')).rejects.toThrow(
      ObjectNotFoundError,
    )
    await expect(driver.headObject('documents/delete-me.jpg')).rejects.toThrow(
      ObjectNotFoundError,
    )
  })

  it('deleteObject is a no-op for a missing key', async () => {
    const driver = createDriver()
    await expect(
      driver.deleteObject('documents/never-existed.jpg'),
    ).resolves.toBeUndefined()
  })

  it('moves an object and its metadata', async () => {
    const driver = createDriver()
    await driver.putObject({
      key: 'tmp/staged.jpg',
      body: new TextEncoder().encode('final'),
      contentType: 'image/jpeg',
      maxSize: 1024,
    })
    await driver.moveObject('tmp/staged.jpg', 'documents/staged.jpg')

    expect(await readBody(driver, 'documents/staged.jpg')).toBe('final')
    const metadata = await driver.headObject('documents/staged.jpg')
    expect(metadata.contentLength).toBe(5)
    expect(metadata.contentType).toBe('image/jpeg')
    await expect(driver.getObject('tmp/staged.jpg')).rejects.toThrow(
      ObjectNotFoundError,
    )
  })

  it('copies an object while keeping the source', async () => {
    const driver = createDriver()
    await driver.putObject({
      key: 'tmp/source.jpg',
      body: new TextEncoder().encode('data'),
      contentType: 'image/png',
      maxSize: 1024,
    })
    await driver.copyObject('tmp/source.jpg', 'documents/copy.jpg')

    expect(await readBody(driver, 'tmp/source.jpg')).toBe('data')
    expect(await readBody(driver, 'documents/copy.jpg')).toBe('data')
    const metadata = await driver.headObject('documents/copy.jpg')
    expect(metadata.contentType).toBe('image/png')
  })

  it('derives keys and URLs from each other', async () => {
    const driver = createDriver()
    const key = 'documents/expense/1.jpg'
    const fileUrl = driver.publicUrlForKey(key)
    expect(fileUrl).toContain('/uploads/documents/expense/1.jpg')
    expect(driver.keyFromFileUrl(fileUrl)).toBe(key)
  })

  it('rejects path traversal in object keys', async () => {
    const driver = createDriver()
    const unsafe = [
      '../outside.jpg',
      'a/../../outside.jpg',
      '/absolute.jpg',
      'a\\backslash.jpg',
      '.hidden.jpg',
    ]
    for (const key of unsafe) {
      await expect(driver.getObject(key)).rejects.toThrow()
      await expect(
        driver.putObject({
          key,
          body: new TextEncoder().encode('x'),
          contentType: 'image/jpeg',
          maxSize: 1024,
        }),
      ).rejects.toThrow()
    }
  })

  it('mints upload URLs carrying a signed key, content type, and size cap', async () => {
    const driver = createDriver()
    const uploadUrl = await driver.getUploadUrl({
      key: 'tmp/imports/1.jpg',
      contentType: 'image/jpeg',
      maxSize: 2048,
    })
    expect(uploadUrl).toContain('/uploads/tmp/imports/1.jpg?token=')

    const url = new URL(uploadUrl)
    const claims = await openUploadToken(url.searchParams.get('token') ?? '')
    expect(claims).toMatchObject({
      key: 'tmp/imports/1.jpg',
      contentType: 'image/jpeg',
      maxSize: 2048,
    })
  })
})
