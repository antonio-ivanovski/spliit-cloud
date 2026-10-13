import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../test/mocks'
import { prismaMock } from '../test/state'
import { ogGroupCard, ogSharePreview } from './og-share'

function testApp() {
  const app = new Hono()
  app.get('/api/og/preview', (c) => ogSharePreview(c))
  app.get('/api/og/group-card.png', (c) => ogGroupCard(c))
  return app
}

const TOKEN = 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'

function pendingInviteRow() {
  return {
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    temporaryName: 'Bob',
    role: 'MEMBER',
    isMultiUse: false,
    useCount: 0,
    group: {
      id: 'grp-1',
      name: 'Summer Trip',
      groupType: 'GROUP',
      emoji: '🏖️',
      color: '#0ea5e9',
      ledger: { currencyCode: 'EUR' },
    },
    invitedBy: { name: 'Alice', image: null },
  } as never
}

beforeEach(() => {
  // Remote images (avatars, Twemoji) fall back to initials in tests: the card
  // must render fully offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ogSharePreview', () => {
  it('rejects requests without credentials', async () => {
    const response = await testApp().request('/api/og/preview')
    expect(response.status).toBe(400)
  })

  it('rejects malformed invite tokens', async () => {
    const response = await testApp().request('/api/og/preview?invite=shrt')
    expect(response.status).toBe(400)
  })

  it('returns group branding fields for a usable invite', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(pendingInviteRow())
    prismaMock.groupMember.count.mockResolvedValue(3 as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      { account: { name: 'Carol', image: 'https://example.com/carol.png' } },
      { account: { name: 'Dave', image: null } },
    ] as never)

    const response = await testApp().request(`/api/og/preview?invite=${TOKEN}`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.kind).toBe('invite')
    expect(body.preview.group).toMatchObject({
      id: 'grp-1',
      name: 'Summer Trip',
      groupType: 'GROUP',
      emoji: '🏖️',
      color: '#0ea5e9',
      currencyCode: 'EUR',
    })
    expect(body.preview.memberCount).toBe(3)
    // Privacy: member names/avatar URLs never leave the server in JSON — the
    // PNG renderer consumes them server-side only.
    expect(body.preview.memberSample).toEqual([])
    expect(body.preview.inviter).toEqual({ name: 'Alice', image: null })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('Carol')
    expect(serialized).not.toContain('Dave')
    expect(serialized).not.toContain('carol.png')
    expect(serialized).not.toContain('@example.com')
    expect(serialized).not.toContain('tokenHash')
    expect(serialized).not.toContain('balance')
    expect(serialized).not.toContain('amount')
  })

  it('redacts group details for dead links instead of oracling them', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      ...pendingInviteRow(),
      status: 'ACCEPTED',
    })

    const response = await testApp().request(`/api/og/preview?invite=${TOKEN}`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.kind).toBe('invite')
    expect(body.preview.usable).toBe(false)
    expect(body.preview.reason).toBe('accepted')
    expect(body.preview.group.name).toBe('')
    expect(body.preview.inviter).toEqual({ name: '', image: null })
    expect(body.preview.temporaryName).toBeNull()
    expect(body.preview.memberCount).toBe(0)
    expect(body.preview.memberSample).toEqual([])
    // No member queries for dead links.
    expect(prismaMock.groupMember.count).not.toHaveBeenCalled()
    expect(prismaMock.groupMember.findMany).not.toHaveBeenCalled()
  })

  it('returns a null preview for unknown tokens without an oracle', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
    const response = await testApp().request(`/api/og/preview?invite=${TOKEN}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'invite', preview: null })
  })

  it('returns view branding fields for a valid viewKey', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Apartment',
      groupType: 'GROUP',
      emoji: null,
      color: null,
      publicViewKey: 'view-key-123',
      ledger: { currencyCode: 'USD' },
    } as never)
    prismaMock.groupMember.count.mockResolvedValue(2 as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      { account: { name: 'Carol', image: null } },
    ] as never)

    const response = await testApp().request(
      '/api/og/preview?groupId=grp-1&viewKey=view-key-123',
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.kind).toBe('view')
    expect(body.preview.group.name).toBe('Apartment')
    expect(body.preview.usable).toBe(true)
    expect(body.preview.memberCount).toBe(2)
    // Member names stay server-side; the JSON carries headcount only.
    expect(body.preview.memberSample).toEqual([])
    expect(JSON.stringify(body)).not.toContain('Carol')
  })

  it('returns a null preview for a wrong viewKey', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Apartment',
      groupType: 'GROUP',
      emoji: null,
      color: null,
      publicViewKey: 'view-key-123',
      ledger: { currencyCode: 'USD' },
    } as never)

    const response = await testApp().request(
      '/api/og/preview?groupId=grp-1&viewKey=wrong-key-4567890123456789',
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'view', preview: null })
  })
})

describe('ogGroupCard', () => {
  it('renders a 1200x630 PNG for a usable invite', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(pendingInviteRow())
    prismaMock.groupMember.count.mockResolvedValue(3 as never)
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)

    const response = await testApp().request(
      `/api/og/group-card.png?invite=${TOKEN}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('renders standard palette colors instead of falling back to primary', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      ...pendingInviteRow(),
      group: { ...pendingInviteRow().group, color: 'teal' },
    })
    prismaMock.groupMember.count.mockResolvedValue(1 as never)
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)

    const response = await testApp().request(
      `/api/og/group-card.png?invite=${TOKEN}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  it('redirects unknown tokens to the static fallback image', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
    const response = await testApp().request(
      `/api/og/group-card.png?invite=${TOKEN}`,
      { redirect: 'manual' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain(
      '/screenshots/desktop-overview-1280x720.png',
    )
  })

  it('renders the expired card instead of group details', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      ...pendingInviteRow(),
      status: 'ACCEPTED',
    })
    prismaMock.groupMember.count.mockResolvedValue(0 as never)
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)

    const response = await testApp().request(
      `/api/og/group-card.png?invite=${TOKEN}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })
})
