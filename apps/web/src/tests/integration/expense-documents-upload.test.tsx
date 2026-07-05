import {
  cleanupTestAccount,
  createTestSession,
  probeExistingApi,
} from '@/test/integration/client'
import { fireEvent, render, waitFor } from '@/test/integration/test-utils'
import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// ── Skip guard (evaluated once at module load) ───────────────────────────

if (!(await probeExistingApi())) {
  throw new Error(
    `API server not running on http://localhost:3001. ` +
      `Start it with \`bun dev\` first.`,
  )
}

// ── Hoisted mocks ────────────────────────────────────────────────────────

const contextMocks = vi.hoisted(() => ({
  mockUseCurrentGroup: vi.fn(),
  mockUseIsPendingInvitee: vi.fn(() => false),
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
  useIsPendingInvitee: contextMocks.mockUseIsPendingInvitee,
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
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// ── Shared state ─────────────────────────────────────────────────────────

const API_URL = 'http://localhost:3001'

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

  let res: Response
  if (isQuery) {
    const inputParam = encodeURIComponent(JSON.stringify({ json: input }))
    res = await fetch(`${API_URL}/trpc/${procedure}?input=${inputParam}`, {
      method: 'GET',
      headers: { Cookie: sessionCookie },
    })
  } else {
    res = await fetch(`${API_URL}/trpc/${procedure}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ json: input }),
    })
  }

  const body = await res.json()
  if (body.error) {
    throw new Error(
      body.error?.json?.message ?? body.error.message ?? 'Unknown tRPC error',
    )
  }
  return body?.result?.data?.json as T
}

// ── Helpers ──────────────────────────────────────────────────────────────

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
  contextMocks.mockUseIsPendingInvitee.mockReturnValue(false)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ExpenseDocumentsInput — real API + real MaxIO', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost'

    sessionCookie = await createTestSession(API_URL, testEmail, testPassword)

    const createResult = await trpcCall<{ groupId: string }>('groups.create', {
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
      linkInviteToken: undefined,
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

    // jsdom's cookie jar is not shared with the undici fetch used by
    // vitest, so credentials:'include' won't send the session cookie.
    // Override fetch to add the auth cookie for API requests instead.
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (url && url.includes('localhost:3001')) {
        const h = new Headers(init?.headers)
        h.set('Cookie', sessionCookie)
        return originalFetch(input, {
          ...init,
          credentials: 'same-origin',
          headers: h,
        })
      }
      return originalFetch(input, init)
    }) as typeof globalThis.fetch

    try {
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

      // Wait for the upload pipeline (presign → PUT to MaxIO → updateDocuments)
      await waitFor(
        () => {
          expect(updateDocuments).toHaveBeenCalledTimes(1)
        },
        { timeout: 15000 },
      )

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

      // Verify the file was stored in MaxIO.
      const headRes = await fetch(documents[0].url, { method: 'HEAD' })
      expect(headRes.ok).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  }, 30000)
})
