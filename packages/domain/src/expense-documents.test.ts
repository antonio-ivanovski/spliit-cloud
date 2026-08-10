import { describe, expect, it } from 'vitest'

import {
  isExpenseDocumentSizeWithinLimit,
  isExpenseDocumentImage,
  isSupportedExpenseDocumentUpload,
  MAX_EXPENSE_DOCUMENT_SIZE,
  mimeTypeForExpenseDocumentFileName,
} from './expense-documents'

describe('expense document types', () => {
  it('recognizes supported receipt documents by MIME type and extension', () => {
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
      }),
    ).toBe(true)
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.odt',
        contentType: 'application/octet-stream',
      }),
    ).toBe(true)
    expect(isSupportedExpenseDocumentUpload({ fileName: 'receipt.csv' })).toBe(
      true,
    )
  })

  it('rejects dangerous or mismatched file types', () => {
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.exe',
        contentType: 'application/octet-stream',
      }),
    ).toBe(false)
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.pdf',
        contentType: 'application/x-msdownload',
      }),
    ).toBe(false)
    for (const [fileName, contentType] of [
      ['receipt.svg', 'image/svg+xml'],
      ['receipt.html', 'text/html'],
      ['receipt.zip', 'application/zip'],
    ]) {
      expect(isSupportedExpenseDocumentUpload({ fileName, contentType })).toBe(
        false,
      )
    }
  })

  it('accepts empty MIME metadata when the extension is safe', () => {
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.pdf',
        contentType: '',
      }),
    ).toBe(true)
    expect(
      isSupportedExpenseDocumentUpload({
        fileName: 'receipt.pdf',
        contentType: 'application/pdf; charset=binary',
      }),
    ).toBe(true)
  })

  it('allows exactly 2 MB and rejects the first byte over the limit', () => {
    expect(MAX_EXPENSE_DOCUMENT_SIZE).toBe(2 * 1024 ** 2)
    expect(isExpenseDocumentSizeWithinLimit(MAX_EXPENSE_DOCUMENT_SIZE)).toBe(
      true,
    )
    expect(
      isExpenseDocumentSizeWithinLimit(MAX_EXPENSE_DOCUMENT_SIZE + 1),
    ).toBe(false)
  })

  it('identifies image attachments and maps extensions', () => {
    expect(isExpenseDocumentImage('image/jpeg')).toBe(true)
    expect(isExpenseDocumentImage('application/pdf')).toBe(false)
    expect(mimeTypeForExpenseDocumentFileName('receipt.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})
