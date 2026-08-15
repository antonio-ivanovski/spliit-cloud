import { createHash } from 'node:crypto'

import { prisma } from '@spliit/db'
import {
  isExpenseDocumentSizeWithinLimit,
  isSupportedExpenseDocumentUpload,
} from '@spliit/domain'

import { randomId } from '../lib/api/shared'
import { getApplicationAuthFromRequest } from '../lib/auth/session'
import {
  openSourceDocumentClaims,
  openCloudStagedDocumentClaims,
  openStagedDocumentClaims,
  sealCloudStagedDocumentClaims,
  sealStagedDocumentClaims,
} from '../lib/import-documents'
import {
  getStorageDriver,
  ObjectNotFoundError,
  objectBodyToBytes,
} from '../lib/storage'

export const MAX_PROFILE_IMAGE_SIZE = 512 * 1024

export function permanentDocumentUrl(fileUrl: string): string {
  const driver = getStorageDriver()
  const key = driver.keyFromFileUrl(fileUrl)
  return key.startsWith('tmp/')
    ? driver.publicUrlForKey(key.replace(/^tmp\//, 'documents/'))
    : fileUrl
}

export async function deleteS3Object(fileUrl: string) {
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) return
  await driver.deleteObject(driver.keyFromFileUrl(fileUrl))
}

export function isProfileImageUrlForAccount(
  fileUrl: string,
  accountId: string,
): boolean {
  try {
    return getStorageDriver()
      .keyFromFileUrl(fileUrl)
      .startsWith(`profile-images/${accountId}/`)
  } catch {
    return false
  }
}

export async function createProfileImageUploadUrl(
  request: Request,
  fileSize?: number,
) {
  const { auth, response } = await getApplicationAuthFromRequest(request)
  if (response) return response
  return mintProfileImagePresign({ fileSize, accountId: auth.user.id })
}

/**
 * Account-bound variant used by the tRPC `uploads.profileImagePresign`
 * mutation. `protectedProcedure` has already resolved the caller, so we skip
 * the cookie round-trip and the size/env-config checks are duplicated from
 * `createProfileImageUploadUrl` to keep both entry points' behavior identical.
 */
export async function mintProfileImagePresign({
  fileSize,
  accountId,
}: {
  fileSize?: number
  accountId: string
}) {
  if (!fileSize || fileSize > MAX_PROFILE_IMAGE_SIZE) {
    return Response.json(
      { error: 'Profile image exceeds the maximum upload size' },
      { status: 400 },
    )
  }
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }

  const key = `profile-images/${accountId}/${randomId()}.jpg`
  const fileUrl = driver.publicUrlForKey(key)
  const uploadUrl = await driver.getUploadUrl({
    key,
    contentType: 'image/jpeg',
  })
  return Response.json({ uploadUrl, fileUrl })
}

export async function validateProfileImageUpload(
  fileUrl: string,
  accountId: string,
) {
  const driver = getStorageDriver()
  if (
    !driver.uploadsConfigured() ||
    !isProfileImageUrlForAccount(fileUrl, accountId)
  ) {
    return false
  }
  try {
    const metadata = await driver.headObject(driver.keyFromFileUrl(fileUrl))
    return (
      metadata.contentType === 'image/jpeg' &&
      !!metadata.contentLength &&
      metadata.contentLength <= MAX_PROFILE_IMAGE_SIZE
    )
  } catch {
    return false
  }
}

/**
 * Promote an uploaded document from the temporary `tmp/` prefix to a permanent
 * `documents/` prefix. Ordinary uploads delete the source; import preparation
 * retains it until the database transaction commits so a failed import can be
 * retried with the same staged token. The local driver promotes via an atomic
 * rename; S3 copies then deletes.
 */
export async function promoteUploadedDocument(
  fileUrl: string,
  options: { deleteSource?: boolean } = {},
): Promise<string> {
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) return fileUrl

  const key = driver.keyFromFileUrl(fileUrl)
  if (!key.startsWith('tmp/')) return fileUrl

  const permanentKey = key.replace(/^tmp\//, 'documents/')

  const permanentObjectExists = async () => {
    try {
      await driver.headObject(permanentKey)
      return true
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return false
      throw error
    }
  }

  // A create retry may arrive after the first request copied and deleted the
  // temporary object but before its response reached the browser.
  if (await permanentObjectExists()) {
    return driver.publicUrlForKey(permanentKey)
  }

  try {
    if (driver.kind === 'local' && options.deleteSource !== false) {
      await driver.moveObject(key, permanentKey)
    } else {
      await driver.copyObject(key, permanentKey)
    }
  } catch (error) {
    // Two same-request attempts may both observe a missing destination before
    // one wins the copy/delete race. If the permanent object now exists, the
    // losing promotion converges on the same URL; otherwise preserve the real
    // copy failure.
    if (await permanentObjectExists())
      return driver.publicUrlForKey(permanentKey)
    throw error
  }

  if (options.deleteSource !== false && driver.kind !== 'local') {
    await driver.deleteObject(key)
  }

  return driver.publicUrlForKey(permanentKey)
}

export async function mintImportDocumentPresign(input: {
  accountId: string
  sessionId: string
  sourceToken: string
  fileSize: number
  width: number
  height: number
}) {
  if (!isExpenseDocumentSizeWithinLimit(input.fileSize)) {
    return Response.json(
      { error: 'File exceeds the maximum upload size' },
      { status: 400 },
    )
  }
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }
  try {
    const source = await openSourceDocumentClaims(input.sourceToken)
    if (
      source.accountId !== input.accountId ||
      source.sessionId !== input.sessionId
    ) {
      return Response.json({ error: 'Invalid import session' }, { status: 403 })
    }
    const key = `tmp/imports/${input.accountId}/${input.sessionId}/${randomId()}.jpg`
    const fileUrl = driver.publicUrlForKey(key)
    const uploadUrl = await driver.getUploadUrl({
      key,
      contentType: 'image/jpeg',
    })
    const stagedToken = await sealStagedDocumentClaims({
      aud: 'spliit:import-staged-document',
      accountId: input.accountId,
      sessionId: input.sessionId,
      expenseIndex: source.expenseIndex,
      sourceDocumentId: source.sourceDocumentId,
      key,
      fileUrl,
      fileSize: input.fileSize,
      width: input.width,
      height: input.height,
    })
    return Response.json({ uploadUrl, stagedToken })
  } catch {
    return Response.json(
      { error: 'Invalid or expired source document' },
      { status: 400 },
    )
  }
}

export async function verifyAndPromoteImportDocument(input: {
  token: string
  accountId: string
  sessionId: string
}) {
  const claims = await openStagedDocumentClaims(input.token)
  if (
    claims.accountId !== input.accountId ||
    claims.sessionId !== input.sessionId ||
    !claims.key.startsWith(`tmp/imports/${input.accountId}/${input.sessionId}/`)
  ) {
    throw new Error('Invalid staged import document')
  }
  const driver = getStorageDriver()
  const permanentUrl = permanentDocumentUrl(claims.fileUrl)
  let metadata
  let url: string | undefined
  try {
    metadata = await driver.headObject(claims.key)
  } catch (temporaryCause) {
    try {
      metadata = await driver.headObject(driver.keyFromFileUrl(permanentUrl))
      url = permanentUrl
    } catch (permanentCause) {
      throw new Error('Staged import document is unavailable', {
        cause: new AggregateError([temporaryCause, permanentCause]),
      })
    }
  }
  if (
    metadata.contentType !== 'image/jpeg' ||
    metadata.contentLength !== claims.fileSize ||
    !metadata.contentLength ||
    !isExpenseDocumentSizeWithinLimit(metadata.contentLength)
  ) {
    throw new Error('Staged import document failed validation')
  }
  if (!url) {
    try {
      url = await promoteUploadedDocument(claims.fileUrl, {
        deleteSource: false,
      })
    } catch (cause) {
      throw new Error('Staged import document could not be promoted', { cause })
    }
  }
  return {
    expenseIndex: claims.expenseIndex,
    sourceDocumentId: claims.sourceDocumentId,
    url,
    temporaryUrl: claims.fileUrl,
    width: claims.width,
    height: claims.height,
  }
}

export async function mintCloudImportDocumentPresign(input: {
  accountId: string
  sessionId: string
  sourceDocumentId: string
  fileName: string | null
  contentType: string | null
  fileSize: number
  width: number | null
  height: number | null
  sha256: string
}) {
  if (!isExpenseDocumentSizeWithinLimit(input.fileSize)) {
    return Response.json(
      { error: 'File exceeds the maximum upload size' },
      { status: 400 },
    )
  }
  const hasDocumentTypeMetadata =
    input.fileName !== null || input.contentType !== null
  if (
    hasDocumentTypeMetadata &&
    !isSupportedExpenseDocumentUpload({
      fileName: input.fileName ?? 'document',
      contentType: input.contentType ?? 'application/octet-stream',
    })
  ) {
    return Response.json(
      { error: 'Unsupported expense document type' },
      { status: 400 },
    )
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    return Response.json(
      { error: 'Invalid document checksum' },
      { status: 400 },
    )
  }
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }

  const extension =
    input.fileName?.match(/(\.[^.\s]+)$/)?.[1]?.toLowerCase() ?? ''
  const key = `tmp/cloud-imports/${input.accountId}/${input.sessionId}/${randomId()}${extension}`
  const fileUrl = driver.publicUrlForKey(key)
  const uploadUrl = await driver.getUploadUrl({
    key,
    contentType: input.contentType ?? 'application/octet-stream',
  })
  const stagedToken = await sealCloudStagedDocumentClaims({
    aud: 'spliit:cloud-staged-document',
    accountId: input.accountId,
    sessionId: input.sessionId,
    sourceDocumentId: input.sourceDocumentId,
    key,
    fileUrl,
    fileName: input.fileName,
    contentType: input.contentType,
    fileSize: input.fileSize,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
  })
  return Response.json({ uploadUrl, stagedToken })
}

export async function verifyAndPromoteCloudImportDocument(input: {
  token: string
  accountId: string
  sessionId: string
}) {
  const claims = await openCloudStagedDocumentClaims(input.token)
  if (
    claims.accountId !== input.accountId ||
    claims.sessionId !== input.sessionId ||
    !claims.key.startsWith(
      `tmp/cloud-imports/${input.accountId}/${input.sessionId}/`,
    )
  ) {
    throw new Error('Invalid staged Cloud import document')
  }
  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) throw new Error('Uploads are not configured')

  let body: Uint8Array
  try {
    const { body: objectBody } = await driver.getObject(claims.key)
    body = await objectBodyToBytes(objectBody)
  } catch (cause) {
    throw new Error('Staged Cloud import document is unavailable', { cause })
  }

  const checksum = createHash('sha256').update(body).digest('hex')
  if (
    body.byteLength !== claims.fileSize ||
    checksum !== claims.sha256 ||
    !isExpenseDocumentSizeWithinLimit(body.byteLength)
  ) {
    throw new Error('Staged Cloud import document failed validation')
  }
  let url: string
  try {
    url = await promoteUploadedDocument(claims.fileUrl, {
      deleteSource: false,
    })
  } catch (cause) {
    throw new Error('Staged Cloud import document could not be promoted', {
      cause,
    })
  }
  return {
    sourceDocumentId: claims.sourceDocumentId,
    url,
    temporaryUrl: claims.fileUrl,
    fileName: claims.fileName,
    contentType: claims.contentType,
    fileSize: claims.fileSize,
    sha256: claims.sha256,
    width: claims.width,
    height: claims.height,
  }
}

/**
 * Internal helper used by both the legacy HTTP `/uploads/presign` route (via
 * `createUploadUrl`) and the tRPC `uploads.presign` mutation. Performs the
 * post-auth work — membership check, file-size validation, upload-URL minting —
 * given an already-resolved account id. Returns a `Response` so the caller
 * decides how to map the status code (HTTP route maps to itself; the tRPC
 * procedure maps via `statusToTRPCCode`).
 */
async function mintUploadPresign({
  ledgerId,
  fileName,
  contentType,
  fileSize,
  accountId,
}: {
  ledgerId: string
  fileName: string
  contentType: string
  fileSize?: number
  accountId: string
}): Promise<Response> {
  if (!isSupportedExpenseDocumentUpload({ fileName, contentType })) {
    return Response.json(
      { error: 'Unsupported expense document type' },
      { status: 400 },
    )
  }
  if (fileSize !== undefined && !isExpenseDocumentSizeWithinLimit(fileSize)) {
    return Response.json(
      { error: 'File exceeds the maximum upload size' },
      { status: 400 },
    )
  }

  const driver = getStorageDriver()
  if (!driver.uploadsConfigured()) {
    return Response.json(
      { error: 'Uploads are not configured' },
      { status: 503 },
    )
  }

  const ledger = await prisma.ledger.findUnique({
    where: { id: ledgerId },
    include: {
      group: {
        include: {
          members: {
            where: { accountId, status: 'ACTIVE' },
          },
        },
      },
    },
  })

  if (!ledger) {
    return Response.json({ error: 'Ledger not found' }, { status: 404 })
  }

  const isMember = ledger.group && ledger.group.members.length > 0
  if (!isMember) {
    return Response.json(
      { error: 'Not authorized to upload to this ledger' },
      { status: 403 },
    )
  }

  const [, extension = ''] = fileName.match(/(\.[^.]*)$/) ?? []
  const key = `tmp/document-${new Date().toISOString()}-${randomId()}${extension.toLowerCase()}`
  const uploadUrl = await driver.getUploadUrl({ key, contentType })
  const fileUrl = driver.publicUrlForKey(key)

  return Response.json({ uploadUrl, fileUrl, key })
}

export async function createUploadUrl(
  request: Request,
  ledgerId: string | undefined,
  fileName: string,
  contentType: string,
  fileSize?: number,
) {
  // Auth is checked first so unauthenticated callers always get 401, even
  // when the server-side uploader is not configured.
  const { auth, response } = await getApplicationAuthFromRequest(request)
  if (response) return response

  // Upload URLs are only minted for authenticated members of the target
  // ledger. Uploads without a ledgerId are not allowed because the resulting
  // document would be unowned and could be attached to any expense.
  if (!ledgerId) {
    return Response.json({ error: 'Missing ledgerId' }, { status: 400 })
  }

  return mintUploadPresign({
    ledgerId,
    fileName,
    contentType,
    fileSize,
    accountId: auth.user.id,
  })
}

/**
 * Mint an upload URL for an already-authenticated account. Used by the tRPC
 * `uploads.presign` mutation — the `protectedProcedure` middleware has already
 * enforced auth, so we skip the authentication round-trip the HTTP-shaped
 * helper requires.
 */
export async function createUploadPresignForAccount({
  ledgerId,
  fileName,
  contentType,
  fileSize,
  accountId,
}: {
  ledgerId: string
  fileName: string
  contentType: string
  fileSize?: number
  accountId: string
}) {
  return mintUploadPresign({
    ledgerId,
    fileName,
    contentType,
    fileSize,
    accountId,
  })
}
