import type { Context } from 'hono'

import { getWebBaseUrl } from '../lib/auth/urls'
import { getLinkInvitationPreview } from '../lib/invitations/link-invitations'
import { logServerWarn } from '../lib/logging'
import { renderGroupCardPng, type GroupCardInput } from '../lib/og/group-card'
import { getGroupViewSharePreview } from '../lib/og/share-preview'

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

function validInviteToken(value: string | undefined): string | null {
  if (!value) return null
  const token = value.trim()
  if (token.length < 16 || token.length > 128) return null
  if (!INVITE_TOKEN_PATTERN.test(token)) return null
  return token
}

function validParam(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

function staticFallbackImageUrl(): string {
  return `${getWebBaseUrl()}/screenshots/desktop-overview-1280x720.png`
}

function shareHeaders(c: Context, cacheControl: string) {
  c.header('Cache-Control', cacheControl)
  c.header('X-Robots-Tag', 'noindex, nofollow')
  c.header('Referrer-Policy', 'no-referrer')
}

/**
 * Public JSON preview for social unfurls. Keyed by the share secret itself (no
 * auth): returns only branding + headcount fields, never expenses, balances, or
 * contact details. Member names/avatar URLs are stripped from the JSON — the
 * PNG renderer consumes them server-side only. Dead links return a minimal `{
 * usable: false, reason }` shape so a captured single-use link is not an oracle
 * for group details. Unknown credentials return a null preview with 200 so
 * crawlers fall back to the generic card without an oracle.
 */
export async function ogSharePreview(c: Context) {
  const invite = validInviteToken(c.req.query('invite') ?? undefined)
  const groupId = validParam(c.req.query('groupId') ?? undefined, 200)
  const viewKey = validParam(c.req.query('viewKey') ?? undefined, 200)

  if (invite) {
    const preview = await getLinkInvitationPreview(invite, {
      includeSharing: true,
    }).catch((err) => {
      logServerWarn('api.og-share', err, { path: '/api/og/preview' })
      return null
    })
    shareHeaders(c, 'public, max-age=60, s-maxage=120')
    return c.json({
      kind: 'invite' as const,
      preview: toInvitePreviewJson(preview),
    })
  }

  if (groupId && viewKey) {
    const preview = await getGroupViewSharePreview(groupId, viewKey).catch(
      (err) => {
        logServerWarn('api.og-share', err, { path: '/api/og/preview' })
        return null
      },
    )
    shareHeaders(c, 'public, max-age=60, s-maxage=120')
    return c.json({
      kind: 'view' as const,
      preview: toViewPreviewJson(preview),
    })
  }

  return c.json(
    { error: 'Expected ?invite= or ?groupId= with ?viewKey=.' },
    400,
  )
}

/**
 * Strip member names/avatar URLs from the invite JSON. The edge worker only
 * needs group branding, the inviter name, and the headcount; avatars are
 * consumed server-side by the PNG renderer. Dead links are reduced to the
 * usability flag + reason so expired/used links reveal no group details.
 */
function toInvitePreviewJson(
  preview: Awaited<ReturnType<typeof getLinkInvitationPreview>>,
) {
  if (!preview) return null
  if (!preview.usable) {
    return {
      group: {
        id: preview.group.id,
        name: '',
        groupType: preview.group.groupType,
        emoji: null,
        color: null,
        currencyCode: null,
      },
      inviter: { name: '', image: null },
      temporaryName: null,
      role: preview.role,
      usable: false as const,
      reason: preview.reason,
      expiresAt: preview.expiresAt,
      isMultiUse: preview.isMultiUse,
      useCount: preview.useCount,
      memberCount: 0,
      memberSample: [],
    }
  }
  return {
    ...preview,
    inviter: { name: preview.inviter.name, image: null },
    memberSample: [],
  }
}

/** Strip member names/avatar URLs from the view JSON (headcount stays). */
function toViewPreviewJson(
  preview: Awaited<ReturnType<typeof getGroupViewSharePreview>>,
) {
  if (!preview) return null
  return { ...preview, memberSample: [] }
}

/**
 * Public 1200x630 social card PNG. Unknown credentials redirect to the static
 * screenshot so `og:image` always resolves; used-up invites render a generic
 * "no longer valid" card instead of group details.
 */
export async function ogGroupCard(c: Context) {
  const invite = validInviteToken(c.req.query('invite') ?? undefined)
  const groupId = validParam(c.req.query('groupId') ?? undefined, 200)
  const viewKey = validParam(c.req.query('viewKey') ?? undefined, 200)

  if (!invite && !(groupId && viewKey)) {
    return c.json(
      { error: 'Expected ?invite= or ?groupId= with ?viewKey=.' },
      400,
    )
  }

  try {
    if (invite) {
      const preview = await getLinkInvitationPreview(invite, {
        includeSharing: true,
      })
      if (!preview) return c.redirect(staticFallbackImageUrl(), 302)
      const input = inviteCardInput(preview)
      const png = await renderGroupCardPng(input)
      // Single-use links flip to expired on accept; keep their cache short.
      const cache = preview.isMultiUse
        ? 'public, max-age=300, s-maxage=600'
        : 'public, max-age=60, s-maxage=120'
      return pngResponse(png, cache)
    }

    const preview = await getGroupViewSharePreview(groupId!, viewKey!)
    if (!preview) return c.redirect(staticFallbackImageUrl(), 302)
    const png = await renderGroupCardPng({
      kind: 'group-view',
      groupName: preview.group.name,
      emoji: preview.group.emoji,
      color: preview.group.color,
      currencyCode: preview.group.currencyCode,
      memberCount: preview.memberCount,
      avatars: preview.memberSample.map((member) => ({
        name: member.name,
        imageUrl: member.image,
      })),
    })
    return pngResponse(png, 'public, max-age=300, s-maxage=600')
  } catch (err) {
    logServerWarn('api.og-share', err, { path: '/api/og/group-card.png' })
    return c.redirect(staticFallbackImageUrl(), 302)
  }
}

function inviteCardInput(
  preview: NonNullable<Awaited<ReturnType<typeof getLinkInvitationPreview>>>,
): GroupCardInput {
  if (!preview.usable) {
    return { kind: 'fallback', note: 'This invite link is no longer valid.' }
  }
  if (preview.group.groupType === 'FRIEND') {
    return {
      kind: 'friend-invite',
      inviterName: preview.inviter.name,
      inviterImageUrl: preview.inviter.image,
      temporaryName: preview.temporaryName,
      currencyCode: preview.group.currencyCode,
    }
  }
  return {
    kind: 'group-invite',
    groupName: preview.group.name,
    emoji: preview.group.emoji,
    color: preview.group.color,
    currencyCode: preview.group.currencyCode,
    memberCount: preview.memberCount,
    inviterName: preview.inviter.name,
    temporaryName: preview.temporaryName,
    avatars: preview.memberSample.map((member) => ({
      name: member.name,
      imageUrl: member.image,
    })),
  }
}

function pngResponse(png: Uint8Array, cacheControl: string) {
  return new Response(png as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.byteLength),
      'Cache-Control': cacheControl,
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
