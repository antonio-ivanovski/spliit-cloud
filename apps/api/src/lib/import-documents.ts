import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { EncryptJWT, jwtDecrypt } from 'jose'
import { z } from 'zod'

import { env } from './env'

const SOURCE_DOCUMENT_AUDIENCE = 'spliit:import-source-document'
const STAGED_DOCUMENT_AUDIENCE = 'spliit:import-staged-document'
const CLOUD_STAGED_DOCUMENT_AUDIENCE = 'spliit:cloud-staged-document'
const SOURCE_FETCH_TIMEOUT_MS = 8_000
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const PAGE_SIZE = 100
const MAX_PAGES = 100

const sourceExpenseInputSchema = z.object({
  sourceCreatedAt: z.iso.datetime().nullable().optional(),
  title: z.string(),
})

export type ImportDocumentDiscoveryInput = z.infer<
  typeof sourceExpenseInputSchema
>

const sourceDocumentClaimsSchema = z.object({
  aud: z.literal(SOURCE_DOCUMENT_AUDIENCE),
  accountId: z.string().min(1),
  sessionId: z.uuid(),
  sourceGroupId: z.string().min(1),
  expenseIndex: z.number().int().nonnegative(),
  sourceDocumentId: z.string().min(1),
  sourceUrl: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export type SourceDocumentClaims = z.infer<typeof sourceDocumentClaimsSchema>

const stagedDocumentClaimsSchema = z.object({
  aud: z.literal(STAGED_DOCUMENT_AUDIENCE),
  accountId: z.string().min(1),
  sessionId: z.uuid(),
  expenseIndex: z.number().int().nonnegative(),
  sourceDocumentId: z.string().min(1),
  key: z.string().min(1),
  fileUrl: z.url(),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export type StagedDocumentClaims = z.infer<typeof stagedDocumentClaimsSchema>

const cloudStagedDocumentClaimsSchema = z.object({
  aud: z.literal(CLOUD_STAGED_DOCUMENT_AUDIENCE),
  accountId: z.string().min(1),
  sessionId: z.uuid(),
  sourceDocumentId: z.string().min(1),
  key: z.string().min(1),
  fileUrl: z.url(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  fileSize: z
    .number()
    .int()
    .nonnegative()
    .max(2 * 1024 * 1024),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type CloudStagedDocumentClaims = z.infer<
  typeof cloudStagedDocumentClaimsSchema
>

function tokenKey() {
  const secret =
    env.BETTER_AUTH_SECRET ??
    'spliit-import-documents-development-secret-change-me'
  return createHash('sha256').update(secret).digest()
}

async function sealClaims(
  audience: string,
  claims: Record<string, unknown>,
  expiresIn: string,
) {
  return new EncryptJWT({ ...claims, aud: audience })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .encrypt(tokenKey())
}

async function openClaims(token: string, audience: string) {
  const { payload } = await jwtDecrypt(token, tokenKey(), {
    audience,
    clockTolerance: 5,
  })
  return payload
}

export function sealSourceDocumentClaims(claims: SourceDocumentClaims) {
  return sealClaims(SOURCE_DOCUMENT_AUDIENCE, claims, '30m')
}

export async function openSourceDocumentClaims(token: string) {
  return sourceDocumentClaimsSchema.parse(
    await openClaims(token, SOURCE_DOCUMENT_AUDIENCE),
  )
}

export function sealStagedDocumentClaims(claims: StagedDocumentClaims) {
  return sealClaims(STAGED_DOCUMENT_AUDIENCE, claims, '24h')
}

export async function openStagedDocumentClaims(token: string) {
  return stagedDocumentClaimsSchema.parse(
    await openClaims(token, STAGED_DOCUMENT_AUDIENCE),
  )
}

export function sealCloudStagedDocumentClaims(
  claims: CloudStagedDocumentClaims,
) {
  return sealClaims(CLOUD_STAGED_DOCUMENT_AUDIENCE, claims, '24h')
}

export async function openCloudStagedDocumentClaims(token: string) {
  return cloudStagedDocumentClaimsSchema.parse(
    await openClaims(token, CLOUD_STAGED_DOCUMENT_AUDIENCE),
  )
}

type UpstreamExpenseListItem = {
  id: string
  createdAt: string
  title: string
  _count?: { documents?: number }
}

type UpstreamExpenseDetail = {
  id: string
  createdAt: string
  title: string
  documents: Array<{
    id: string
    url: string
    width: number
    height: number
  }>
}

function unwrapTrpcResult(value: unknown): unknown {
  const root = value as {
    result?: { data?: unknown }
    error?: { json?: { message?: string } }
  }
  if (root.error) {
    throw new Error(root.error.json?.message ?? 'spliit.app request failed')
  }
  const data = root.result?.data
  if (data && typeof data === 'object' && 'json' in data) {
    return (data as { json: unknown }).json
  }
  return data
}

async function callUpstreamTrpc(
  path: string,
  input: Record<string, unknown>,
  fetchImpl: typeof fetch,
) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }))
  const response = await fetchImpl(
    `https://spliit.app/api/trpc/${path}?input=${encoded}`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
    },
  )
  if (!response.ok) {
    throw new Error(`spliit.app responded with HTTP ${response.status}`)
  }
  return unwrapTrpcResult(await response.json())
}

export type ImportDocumentDiscoveryResult = {
  documents: Array<{
    expenseIndex: number
    expenseTitle: string
    sourceDocumentId: string
    width: number
    height: number
    token: string
  }>
  failures: Array<{
    expenseTitle: string
    documentCount: number
    message: string
  }>
}

export async function discoverSpliitDocuments(args: {
  accountId: string
  sessionId: string
  sourceGroupId: string
  expenses: ImportDocumentDiscoveryInput[]
  fetchImpl?: typeof fetch
}): Promise<ImportDocumentDiscoveryResult> {
  const fetchImpl = args.fetchImpl ?? fetch
  const expenses = z.array(sourceExpenseInputSchema).parse(args.expenses)
  const sourceIndexByCreatedAt = new Map<string, number[]>()
  expenses.forEach((expense, index) => {
    if (!expense.sourceCreatedAt) return
    const rows = sourceIndexByCreatedAt.get(expense.sourceCreatedAt) ?? []
    rows.push(index)
    sourceIndexByCreatedAt.set(expense.sourceCreatedAt, rows)
  })

  const upstreamWithDocuments: UpstreamExpenseListItem[] = []
  let cursor = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const value = (await callUpstreamTrpc(
      'groups.expenses.list',
      { groupId: args.sourceGroupId, cursor, limit: PAGE_SIZE },
      fetchImpl,
    )) as {
      expenses?: UpstreamExpenseListItem[]
      hasMore?: boolean
      nextCursor?: number
    }
    for (const expense of value.expenses ?? []) {
      if ((expense._count?.documents ?? 0) > 0) {
        upstreamWithDocuments.push(expense)
      }
    }
    if (!value.hasMore) break
    cursor = value.nextCursor ?? cursor + PAGE_SIZE
  }

  const documents: ImportDocumentDiscoveryResult['documents'] = []
  const failures: ImportDocumentDiscoveryResult['failures'] = []
  for (const listed of upstreamWithDocuments) {
    const matches = sourceIndexByCreatedAt.get(listed.createdAt) ?? []
    if (matches.length !== 1) {
      failures.push({
        expenseTitle: listed.title,
        documentCount: listed._count?.documents ?? 1,
        message:
          matches.length === 0
            ? 'Could not match this expense to the imported JSON.'
            : 'The imported JSON contains an ambiguous expense timestamp.',
      })
      continue
    }
    const expenseIndex = matches[0]!
    if (expenses[expenseIndex]!.title !== listed.title) {
      failures.push({
        expenseTitle: listed.title,
        documentCount: listed._count?.documents ?? 1,
        message: 'The imported expense title does not match spliit.app.',
      })
      continue
    }
    try {
      const value = (await callUpstreamTrpc(
        'groups.expenses.get',
        { groupId: args.sourceGroupId, expenseId: listed.id },
        fetchImpl,
      )) as { expense?: UpstreamExpenseDetail }
      const detail = value.expense
      if (!detail) throw new Error('spliit.app returned no expense details')
      for (const document of detail.documents ?? []) {
        const claims: SourceDocumentClaims = {
          aud: SOURCE_DOCUMENT_AUDIENCE,
          accountId: args.accountId,
          sessionId: args.sessionId,
          sourceGroupId: args.sourceGroupId,
          expenseIndex,
          sourceDocumentId: document.id,
          sourceUrl: document.url,
          width: document.width,
          height: document.height,
        }
        documents.push({
          expenseIndex,
          expenseTitle: expenses[expenseIndex]!.title,
          sourceDocumentId: document.id,
          width: document.width,
          height: document.height,
          token: await sealSourceDocumentClaims(claims),
        })
      }
    } catch (error) {
      failures.push({
        expenseTitle: listed.title,
        documentCount: listed._count?.documents ?? 1,
        message:
          error instanceof Error
            ? error.message
            : 'Could not fetch expense documents.',
      })
    }
  }
  return { documents, failures }
}

function isPrivateAddress(address: string): boolean {
  const unbracketed = address.replace(/^\[|\]$/g, '')
  if (
    unbracketed === '::' ||
    unbracketed === '0:0:0:0:0:0:0:0' ||
    unbracketed === '::1' ||
    unbracketed === '0:0:0:0:0:0:0:1'
  ) {
    return true
  }
  const lower = unbracketed.toLowerCase()
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('fe8') || lower.startsWith('fe9')) return true
  if (lower.startsWith('fea') || lower.startsWith('feb')) return true
  if (isIP(lower) === 6) {
    const canonical = new URL(`http://[${lower}]`).hostname.slice(1, -1)
    const mapped = canonical.match(/^::ffff:([\da-f]+):([\da-f]+)$/)
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16)
      const low = Number.parseInt(mapped[2]!, 16)
      return isPrivateAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      )
    }
    return false
  }
  if (isIP(lower) !== 4) return false
  const [a, b] = lower.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

async function assertPublicHttpsUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Source document URL is not a public HTTPS URL')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some((row) => isPrivateAddress(row.address))
  ) {
    throw new Error('Source document URL resolves to a private address')
  }
  return url
}

function imageKind(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  return null
}

export async function fetchSourceDocument(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: 'image/jpeg' | 'image/png' }> {
  let current = await assertPublicHttpsUrl(sourceUrl)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/jpeg,image/png' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error('Source document redirected too many times')
      }
      current = await assertPublicHttpsUrl(
        new URL(location, current).toString(),
      )
      continue
    }
    if (!response.ok || !response.body) {
      throw new Error(`Source document responded with HTTP ${response.status}`)
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_SOURCE_BYTES) {
      throw new Error('Source document exceeds the 5 MiB limit')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_SOURCE_BYTES) {
        await reader.cancel()
        throw new Error('Source document exceeds the 5 MiB limit')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const contentType = imageKind(bytes)
    if (!contentType)
      throw new Error('Source document is not a JPEG or PNG image')
    return { bytes, contentType }
  }
  throw new Error('Could not fetch source document')
}
