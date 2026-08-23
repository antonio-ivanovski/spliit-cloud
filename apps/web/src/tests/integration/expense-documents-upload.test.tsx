import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  cleanupTestAccount,
  createTestSession,
  INTEGRATION_API_URL,
  integrationFetch,
  probeExistingApi,
} from '@/test/integration/client'
import { fireEvent, render, waitFor } from '@/test/integration/test-utils'
import { prisma } from '@spliit/db'

// ── Skip guard (evaluated once at module load) ───────────────────────────

if (!(await probeExistingApi())) {
  throw new Error(
    `API server not running on ${INTEGRATION_API_URL}. ` +
      `Start it with \`bun --filter @spliit/api start:integration\` first.`,
  )
}

// ── Hoisted mocks ────────────────────────────────────────────────────────

const contextMocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsReadOnlyGroupViewer: vi.fn(() => false),
}))

const tanstackMocks = vi.hoisted(() => ({
  mockUseSearch: vi.fn(() => ({})),
  mockUseLocation: vi.fn(() => ({ pathname: '/groups/test-group' })),
}))

// ── Module mocks (hoisted to top) ────────────────────────────────────────

vi.mock(import('@/lib/upload'), async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    resizeImage: async (file: File) => ({
      file,
      width: 1,
      height: 1,
    }),
  }
})

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: contextMocks.mockUseCurrentGroup,
  useCurrentGroupOrNull: () => null,
  useIsReadOnlyGroupViewer: contextMocks.mockUseIsReadOnlyGroupViewer,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useSearch: tanstackMocks.mockUseSearch,
  useLocation: tanstackMocks.mockUseLocation,
  useNavigate: () => vi.fn(),
}))

// ── Shared state ─────────────────────────────────────────────────────────

const API_URL = INTEGRATION_API_URL

let sessionCookie: string
const testEmail = `test-doc-${Date.now()}@integration-spliit.local`
const testPassword = 'TestPass123!'

interface TestGroup {
  id: string
  ledger: {
    id: string
  }
}

let testGroup: TestGroup

// ── tRPC helper ──────────────────────────────────────────────────────────

const queryProcedures = new Set([
  'groups.get',
  'groups.list',
  'groups.balances.list',
  'groups.expenses.list',
])

async function trpcCall<T = unknown>(
  procedure: string,
  input: unknown,
): Promise<T> {
  const isQuery = queryProcedures.has(procedure)

  let res: Awaited<ReturnType<typeof integrationFetch>>
  if (isQuery) {
    const inputParam = encodeURIComponent(JSON.stringify({ json: input }))
    res = await integrationFetch(
      `${API_URL}/trpc/${procedure}?input=${inputParam}`,
      {
        method: 'GET',
        headers: { Cookie: sessionCookie },
      },
    )
  } else {
    res = await integrationFetch(`${API_URL}/trpc/${procedure}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ json: input }),
    })
  }

  const body = (await res.json()) as {
    error?: { json?: { message?: string }; message?: string }
    result?: { data?: { json: T } }
  }
  if (body.error) {
    throw new Error(
      body.error?.json?.message ?? body.error.message ?? 'Unknown tRPC error',
    )
  }
  return body?.result?.data?.json as T
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Duck-typing check for Blob/File-like objects (jsdom, Bun, etc.). */
function isBlobLikeBody(
  body: unknown,
): body is { size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> } {
  if (!body || typeof body !== 'object') return false
  return (
    typeof (body as Record<string, unknown>).size === 'number' &&
    typeof (body as Record<string, unknown>).type === 'string' &&
    typeof (body as Record<string, unknown>).arrayBuffer === 'function'
  )
}

function setupGroupContext() {
  contextMocks.mockUseCurrentGroup.mockReturnValue({
    isLoading: false,
    groupId: testGroup.id,
    group: {
      id: testGroup.id,
      name: 'Doc Upload Test',
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ledgerId: testGroup.ledger.id,
      information: null,
      currency: 'EUR',
      currencyCode: 'EUR',
      ledger: {
        id: testGroup.ledger.id,
        currency: 'EUR',
        currencyCode: 'EUR',
        groupId: testGroup.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      participants: [],
      members: [],
      invitations: [],
    },
    currentLedgerParticipantId: 'lp-dummy',
    currentMember: { id: 'cm-dummy', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
  })
  contextMocks.mockUseIsReadOnlyGroupViewer.mockReturnValue(false)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ExpenseDocumentsInput — real API + real MaxIO', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'

    sessionCookie = await createTestSession(API_URL, testEmail, testPassword)

    const createResult = await trpcCall<{ groupId: string }>('groups.create', {
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: 'Doc Upload Test',
        currency: 'EUR',
        participants: [{ name: 'Admin' }],
      },
    })

    const groupResult = await trpcCall<{
      group: TestGroup
      currentLedgerParticipantId: string | null
    }>('groups.get', {
      groupId: createResult.groupId,
    })

    testGroup = groupResult.group
  }, 30000)

  afterAll(async () => {
    try {
      process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'
      if (testGroup?.id) {
        await prisma.group
          .delete({ where: { id: testGroup.id } })
          .catch(() => {})
      }
    } catch {
      // ignore — best-effort cleanup
    }
    await cleanupTestAccount(testEmail)
  }, 10000)

  it('uploads a 1x1 JPEG and returns document with correct dimensions and URL', async () => {
    setupGroupContext()

    // happy-dom's fetch strips Cookie/Set-Cookie per the Fetch spec and
    // cannot handle jsdom File/Blob bodies as BodyInit for Bun's native
    // fetch. Use undici for all http(s) requests so auth is preserved and
    // binary PUTs to MaxIO are reliable under CI concurrency=2.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url

      // Normalise Blob/File-like bodies to ArrayBuffer for both fetch
      // implementations — jsdom's File is not valid BodyInit for undici
      // or Bun's native fetch when passed via happy-dom.
      let reqBody: unknown = init?.body
      // If input is a Request with a blob body and no init.body, extract it.
      if (reqBody === undefined && input instanceof Request) {
        try {
          const clone = (input as Request).clone()
          const buf = await clone.arrayBuffer()
          if (buf.byteLength) reqBody = buf
        } catch {
          // ignore — fall through to original body handling
        }
      }
      if (isBlobLikeBody(reqBody)) {
        reqBody = await (
          reqBody as { arrayBuffer(): Promise<ArrayBuffer> }
        ).arrayBuffer()
      }

      const isHttp =
        !!url && (url.startsWith('http://') || url.startsWith('https://'))

      if (isHttp) {
        const h = new Headers(init?.headers)
        // Merge headers from a Request input if present.
        if (input instanceof Request) {
          for (const [k, v] of (input as Request).headers.entries()) {
            if (!h.has(k)) h.set(k, v)
          }
        }
        if (url.startsWith(API_URL)) {
          h.set('Cookie', sessionCookie)
        }
        // Plain-object headers: undici must not receive a happy-dom Headers
        // instance (cross-realm brand checks fail in happy-dom).
        return integrationFetch(
          input as Parameters<typeof integrationFetch>[0],
          {
            ...init,
            method:
              init?.method ??
              (input instanceof Request ? input.method : undefined),
            body: reqBody as NonNullable<
              Parameters<typeof integrationFetch>[1]
            >['body'],
            headers: Object.fromEntries(h.entries()),
            // undici handles duplex automatically for ArrayBuffer/strings
          } as Parameters<typeof integrationFetch>[1],
        )
      }
      return originalFetch(input as RequestInfo, {
        ...init,
        body: reqBody as BodyInit | null | undefined,
      })
    }) as typeof globalThis.fetch

    try {
      // Surface any errors swallowed by the upload component's catch
      // so flaky CI runs leave a clear trace of what went wrong.
      const consoleErrorSpy = vi.spyOn(console, 'error')

      const updateDocuments = vi.fn()

      const { ExpenseDocumentsInput } =
        await import('@/components/expense-documents-input')

      const { container } = render(
        <ExpenseDocumentsInput
          documents={[]}
          updateDocuments={updateDocuments}
          ledgerId={testGroup.ledger.id}
        />,
      )

      // The FileInput is rendered as a hidden <input type="file">.
      const fileInput =
        container.querySelector<HTMLInputElement>('input[type="file"]')
      expect(fileInput).not.toBeNull()

      // Simulate selecting a JPEG file.
      const testFile = new File(
        [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
        'receipt.jpg',
        { type: 'image/jpeg' },
      )
      fireEvent.change(fileInput!, { target: { files: [testFile] } })

      // Wait for the upload pipeline (presign → PUT to MaxIO → updateDocuments).
      // 30s accommodates CI where turbo runs api+web in parallel (concurrency=2)
      // and MaxIO can be briefly contended.
      try {
        await waitFor(
          () => {
            expect(updateDocuments).toHaveBeenCalledTimes(1)
          },
          { timeout: 30000, interval: 200 },
        )
      } catch (cause) {
        // Dump swallowed errors for CI diagnostics before failing the test.
        if (consoleErrorSpy.mock.calls.length) {
          console.log(
            '[expense-documents-upload] console.error calls:',
            consoleErrorSpy.mock.calls
              .map((a) => a.map((v) => String(v)).join(' '))
              .join('\n'),
          )
        }
        throw cause
      }

      const documents = updateDocuments.mock.calls[0][0] as Array<{
        id: string
        url: string
        width: number
        height: number
      }>
      expect(documents).toHaveLength(1)
      expect(documents[0].url).toMatch(/spliit-local\/tmp\//)
      expect(documents[0].width).toBe(1)
      expect(documents[0].height).toBe(1)

      // Object persistence in MaxIO is verified by the API/S3 integration
      // suite using authenticated helpers (objectExists). Relying on an
      // unauthenticated public HEAD here flaked when MaxIO returned 403/404
      // in CI even though the signed PUT had already succeeded.
    } finally {
      globalThis.fetch = originalFetch
      vi.restoreAllMocks()
    }
  }, 45000)
})
