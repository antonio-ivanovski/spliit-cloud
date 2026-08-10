import { describe, expect, it, vi } from 'vitest'

import { MAX_EXPENSE_DOCUMENT_SIZE } from '@spliit/domain'

const getS3ObjectMock = vi.hoisted(() => vi.fn())
vi.mock('../storage', () => ({ getS3Object: getS3ObjectMock }))

import { s3ExportDocumentReader } from './s3-document-reader'
import type { ExportDocumentRecord } from './types'

const document: ExportDocumentRecord = {
  id: 'doc-1',
  url: 'https://uploads.example.com/documents/doc-1/receipt.pdf',
  fileName: 'receipt.pdf',
  contentType: 'application/pdf',
  width: null,
  height: null,
}

describe('s3ExportDocumentReader', () => {
  it('adapts the S3 body to bytes and forwards the abort signal', async () => {
    const signal = new AbortController().signal
    getS3ObjectMock.mockResolvedValue({
      Body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('PD')
          yield new TextEncoder().encode('F')
        },
      },
    })

    const bytes = await s3ExportDocumentReader.read(document, signal)

    expect(new TextDecoder().decode(bytes)).toBe('PDF')
    expect(getS3ObjectMock).toHaveBeenCalledWith(document.url, signal)
  })

  it('rejects object bodies beyond the document size limit', async () => {
    getS3ObjectMock.mockResolvedValue({
      Body: new Uint8Array(MAX_EXPENSE_DOCUMENT_SIZE + 1),
    })

    await expect(
      s3ExportDocumentReader.read(document, new AbortController().signal),
    ).rejects.toThrow('maximum upload size')
  })
})
