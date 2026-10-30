import { describe, expect, it, vi } from 'vitest'

import { env } from '../lib/env'
import '../test/mocks'
import { mintPersonalPresign } from './upload'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async () => 'https://s3.example.com/presigned-upload-url',
  ),
}))

const mockS3Client = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return mockS3Client
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  CopyObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
  HeadObjectCommand: vi.fn(function (input: unknown) {
    return input
  }),
}))

describe('mintPersonalPresign', () => {
  it('rejects unsupported attachment types', async () => {
    const response = await mintPersonalPresign({
      fileName: 'receipt.exe',
      contentType: 'application/octet-stream',
      accountId: 'acct-1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unsupported expense document type',
    })
  })

  it('rejects files exceeding the size limit', async () => {
    const response = await mintPersonalPresign({
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      fileSize: 3 * 1024 ** 2,
      accountId: 'acct-1',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'File exceeds the maximum upload size',
    })
  })

  it('returns 503 when uploads are not configured', async () => {
    const originalBucket = env.S3_UPLOAD_BUCKET
    env.S3_UPLOAD_BUCKET = ''
    try {
      const response = await mintPersonalPresign({
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
        accountId: 'acct-1',
      })
      expect(response.status).toBe(503)
    } finally {
      env.S3_UPLOAD_BUCKET = originalBucket
    }
  })

  it('mints an account-scoped tmp key with a 60s expiry', async () => {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

    const response = await mintPersonalPresign({
      fileName: 'Receipt.PDF',
      contentType: 'application/pdf',
      fileSize: 1024,
      accountId: 'acct-1',
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.uploadUrl).toBe('https://s3.example.com/presigned-upload-url')
    expect(body.key).toMatch(/^tmp\/personal\/acct-1\/.+\.pdf$/)
    expect(body.fileUrl).toContain(body.key)
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: 'spliit-test-bucket',
        Key: body.key,
        ContentType: 'application/pdf',
      }),
      { expiresIn: 60 },
    )
  })
})
