import { afterEach, describe, expect, it, vi } from 'vitest'

import { PresignedUploadError, uploadToPresignedUrl } from '@/lib/upload'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('uploadToPresignedUrl', () => {
  it('uploads the supplied body and content type', async () => {
    const body = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    await uploadToPresignedUrl({
      uploadUrl: 'https://uploads.example.test/receipt',
      body,
      contentType: 'image/jpeg',
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://uploads.example.test/receipt',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body,
      }),
    )
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))

    await uploadToPresignedUrl({
      uploadUrl: 'https://uploads.example.test/receipt',
      body: new Blob(),
      contentType: 'application/octet-stream',
      signal: controller.signal,
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('throws an error containing the response status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    )

    await expect(
      uploadToPresignedUrl({
        uploadUrl: 'https://uploads.example.test/receipt',
        body: new Blob(),
        contentType: 'application/octet-stream',
      }),
    ).rejects.toEqual(new PresignedUploadError(403))
  })
})
