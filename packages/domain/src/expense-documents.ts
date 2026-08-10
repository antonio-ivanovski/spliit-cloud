export const EXPENSE_DOCUMENT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

export const EXPENSE_DOCUMENT_FILE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
] as const

export const EXPENSE_DOCUMENT_MIME_TYPES = [
  ...EXPENSE_DOCUMENT_IMAGE_MIME_TYPES,
  ...EXPENSE_DOCUMENT_FILE_MIME_TYPES,
] as const

export const MAX_EXPENSE_DOCUMENT_SIZE = 2 * 1024 ** 2

export const EXPENSE_DOCUMENT_IMAGE_ACCEPT =
  EXPENSE_DOCUMENT_IMAGE_MIME_TYPES.join(',')

export const EXPENSE_DOCUMENT_ACCEPT = EXPENSE_DOCUMENT_MIME_TYPES.join(',')

export function isExpenseDocumentSizeWithinLimit(fileSize: number): boolean {
  return fileSize >= 0 && fileSize <= MAX_EXPENSE_DOCUMENT_SIZE
}

const MIME_BY_EXTENSION: Record<
  string,
  (typeof EXPENSE_DOCUMENT_MIME_TYPES)[number]
> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

export function isExpenseDocumentImage(contentType?: string | null): boolean {
  return EXPENSE_DOCUMENT_IMAGE_MIME_TYPES.includes(
    contentType as (typeof EXPENSE_DOCUMENT_IMAGE_MIME_TYPES)[number],
  )
}

export function mimeTypeForExpenseDocumentFileName(
  fileName: string,
): (typeof EXPENSE_DOCUMENT_MIME_TYPES)[number] | undefined {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return MIME_BY_EXTENSION[extension]
}

export function isSupportedExpenseDocumentUpload(input: {
  fileName: string
  contentType?: string | null
}): boolean {
  const contentType = input.contentType?.toLowerCase().split(';', 1)[0]
  const extensionType = mimeTypeForExpenseDocumentFileName(input.fileName)
  if (
    contentType &&
    contentType !== 'application/octet-stream' &&
    extensionType &&
    contentType !== extensionType
  ) {
    return false
  }
  if (
    contentType &&
    contentType !== 'application/octet-stream' &&
    EXPENSE_DOCUMENT_MIME_TYPES.includes(
      contentType as (typeof EXPENSE_DOCUMENT_MIME_TYPES)[number],
    )
  ) {
    return true
  }
  return extensionType !== undefined
}
