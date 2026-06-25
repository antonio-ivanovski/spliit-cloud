import { describe, expect, it, vi } from 'vitest'
import { env } from '../lib/env'
import '../test/mocks'
import { authState, prismaMock } from '../test/state'
import { createUploadUrl } from './upload'

function makeRequest(): Request {
  return new Request('http://localhost/uploads/presign', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  })
}

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async () => 'https://s3.example.com/presigned-upload-url',
  ),
}))

describe('createUploadUrl', () => {
  it('returns 401 when the caller is not authenticated (and skips env lookup)', async () => {
    authState.session = null

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthenticated')
    expect(prismaMock.ledger.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when ledgerId is missing', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })

    const response = await createUploadUrl(
      makeRequest(),
      undefined,
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Missing ledgerId')
    expect(prismaMock.ledger.findUnique).not.toHaveBeenCalled()
  })

  it("returns 403 when the caller is not an active member of the ledger's group", async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.ledger.findUnique.mockResolvedValue({
      id: 'ledger-1',
      group: {
        members: [], // no active membership for this account
      },
    } as never)

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Not authorized to upload to this ledger')
  })

  it('returns 400 when the file size exceeds the limit', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
      3 * 1024 ** 2, // 3 MB > 2 MB limit
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('File exceeds the maximum upload size')
  })

  it('returns 404 when the ledger does not exist', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.ledger.findUnique.mockResolvedValue(null)

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(404)
  })

  it('returns a presigned URL when the caller is an active member', async () => {
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.ledger.findUnique.mockResolvedValue({
      id: 'ledger-1',
      group: {
        members: [
          {
            accountId: 'acct-1',
            status: 'ACTIVE',
          },
        ],
      },
    } as never)

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.uploadUrl).toBe('https://s3.example.com/presigned-upload-url')
    expect(typeof body.fileUrl).toBe('string')
    expect(body.fileUrl).toContain('spliit-test-bucket')
    expect(body.fileUrl).toMatch(/\.pdf$/)
  })

  it('uses S3_UPLOAD_PUBLIC_URL for browser-readable file URLs when configured', async () => {
    env.S3_UPLOAD_PUBLIC_URL = 'https://uploads.spliit.cloud/'
    authState.session = {
      user: { id: 'acct-1' },
      session: { id: 'sess-1' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
    })
    prismaMock.ledger.findUnique.mockResolvedValue({
      id: 'ledger-1',
      group: {
        members: [
          {
            accountId: 'acct-1',
            status: 'ACTIVE',
          },
        ],
      },
    } as never)

    const response = await createUploadUrl(
      makeRequest(),
      'ledger-1',
      'receipt.pdf',
      'application/pdf',
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.fileUrl).toMatch(/^https:\/\/uploads\.spliit\.cloud\/document-/)
    expect(body.fileUrl).toMatch(/\.pdf$/)
    env.S3_UPLOAD_PUBLIC_URL = undefined
  })
})
