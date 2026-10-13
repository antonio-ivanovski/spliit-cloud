import type { ReactNode } from 'react'

import { resolveGroupColorHex } from '@spliit/domain'

import { loadOgFonts } from './fonts'
import { loadOgLogo, OG_LOGO_HEIGHT, OG_LOGO_WIDTH } from './logo'
import {
  fetchEmojiImage,
  fetchImageAsDataUri,
  firstGrapheme,
} from './remote-images'

export const OG_CARD_WIDTH = 1200
export const OG_CARD_HEIGHT = 630

const PRIMARY = '#047857'
const INK = '#111827'
const MUTED = '#4b5563'
const PILL_BG = '#f3f4f6'
const PILL_INK = '#374151'

export type GroupCardAvatar = {
  name: string | null
  imageUrl: string | null
}

export type GroupCardInput =
  | {
      kind: 'group-invite'
      groupName: string
      emoji: string | null
      color: string | null
      currencyCode: string | null
      memberCount: number
      inviterName: string
      temporaryName: string | null
      avatars: GroupCardAvatar[]
    }
  | {
      kind: 'group-view'
      groupName: string
      emoji: string | null
      color: string | null
      currencyCode: string | null
      memberCount: number
      avatars: GroupCardAvatar[]
    }
  | {
      kind: 'friend-invite'
      inviterName: string
      inviterImageUrl: string | null
      temporaryName: string | null
      currencyCode: string | null
    }
  | { kind: 'fallback'; note: string | null }

type ResolvedAvatar = { initials: string; dataUri: string | null }

function initialsFor(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase()
}

function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/).filter(Boolean)[0] ?? ''
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!match) return `rgba(4, 120, 87, ${alpha})`
  let raw = match[1]!
  if (raw.length === 3) {
    raw = raw
      .split('')
      .map((char) => char + char)
      .join('')
  }
  const value = Number.parseInt(raw, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function memberLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`
}

function avatarStackLabel(
  names: (string | null)[],
  count: number,
): string | null {
  const shown = names.map(firstName).filter(Boolean).slice(0, 3)
  if (shown.length === 0) return null
  if (count > shown.length)
    return `${shown.join(', ')} +${count - shown.length}`
  return shown.join(', ')
}

function AvatarCircle({
  avatar,
  size,
  overlap,
}: {
  avatar: ResolvedAvatar
  size: number
  overlap?: boolean
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: hexToRgba(PRIMARY, 0.15),
        border: `3px solid #ffffff`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: overlap ? -size * 0.25 : 0,
        flexShrink: 0,
      }}
    >
      {avatar.dataUri ? (
        <img
          src={avatar.dataUri}
          alt=""
          width={size - 6}
          height={size - 6}
          style={{ borderRadius: 999 }}
        />
      ) : (
        <div
          style={{
            fontSize: size * 0.36,
            fontWeight: 700,
            color: PRIMARY,
          }}
        >
          {avatar.initials}
        </div>
      )}
    </div>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 26,
        fontWeight: 700,
        color: PILL_INK,
        backgroundColor: PILL_BG,
        borderRadius: 999,
        padding: '10px 22px',
      }}
    >
      {children}
    </div>
  )
}

function BrandFooter({ logoDataUri }: { logoDataUri: string | null }) {
  if (logoDataUri) {
    return (
      <img
        src={logoDataUri}
        alt="Spliit Cloud"
        width={OG_LOGO_WIDTH}
        height={OG_LOGO_HEIGHT}
        style={{ width: OG_LOGO_WIDTH, height: OG_LOGO_HEIGHT }}
      />
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: PRIMARY,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 26,
          fontWeight: 700,
          color: '#ffffff',
        }}
      >
        S
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: INK }}>
        Spliit Cloud
      </div>
    </div>
  )
}

type ResolvedCard =
  | {
      kind: 'group'
      eyebrow: string
      title: string
      subtitle: string
      pills: string[]
      tile: { emojiUri: string | null; fallbackLetter: string }
      avatars: ResolvedAvatar[]
      stackLabel: string | null
      accent: string
    }
  | {
      kind: 'friend'
      eyebrow: string
      title: string
      subtitle: string
      pills: string[]
      avatars: [ResolvedAvatar, ResolvedAvatar]
      accent: string
    }
  | { kind: 'fallback'; note: string | null }

function GroupTile({
  tile,
  accent,
}: {
  tile: { emojiUri: string | null; fallbackLetter: string }
  accent: string
}) {
  return (
    <div
      style={{
        width: 248,
        height: 248,
        borderRadius: 56,
        backgroundColor: hexToRgba(accent, 0.14),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {tile.emojiUri ? (
        <img src={tile.emojiUri} alt="" width={150} height={150} />
      ) : (
        <div style={{ fontSize: 120, fontWeight: 700, color: accent }}>
          {tile.fallbackLetter}
        </div>
      )}
    </div>
  )
}

function CardElement({
  card,
  logoDataUri,
}: {
  card: ResolvedCard
  logoDataUri: string | null
}) {
  if (card.kind === 'fallback') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            padding: 64,
          }}
        >
          <BrandFooter logoDataUri={logoDataUri} />
          <div style={{ fontSize: 52, fontWeight: 700, color: INK }}>
            Share expenses with friends &amp; family
          </div>
          {card.note ? (
            <div
              style={{
                fontSize: 28,
                color: MUTED,
                backgroundColor: PILL_BG,
                borderRadius: 999,
                padding: '12px 28px',
              }}
            >
              {card.note}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const pills =
    card.kind === 'group' || card.kind === 'friend' ? card.pills : []

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#ffffff',
        backgroundImage: `linear-gradient(115deg, ${hexToRgba(card.accent, 0.1)} 0%, #ffffff 55%)`,
        fontFamily: 'Inter',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 56,
          padding: '64px 64px 0',
        }}
      >
        {card.kind === 'group' ? (
          <GroupTile tile={card.tile} accent={card.accent} />
        ) : (
          <div
            style={{
              width: 248,
              height: 248,
              borderRadius: 56,
              backgroundColor: hexToRgba(card.accent, 0.14),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <AvatarCircle avatar={card.avatars[0]!} size={118} />
              <AvatarCircle avatar={card.avatars[1]!} size={118} overlap />
            </div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: PRIMARY,
              letterSpacing: 2,
            }}
          >
            {card.eyebrow}
          </div>
          <div
            style={{
              fontSize: 66,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.05,
              maxHeight: 140,
              overflow: 'hidden',
            }}
          >
            {card.title}
          </div>
          <div style={{ fontSize: 30, color: MUTED }}>{card.subtitle}</div>
          {pills.length > 0 ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {pills.map((pill) => (
                <Pill key={pill}>{pill}</Pill>
              ))}
            </div>
          ) : null}
          {card.kind === 'group' && card.avatars.length > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                marginTop: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {card.avatars.map((avatar, index) => (
                  <AvatarCircle
                    key={`${avatar.initials}-${index}`}
                    avatar={avatar}
                    size={60}
                    overlap={index > 0}
                  />
                ))}
              </div>
              {card.stackLabel ? (
                <div style={{ fontSize: 26, color: MUTED }}>
                  {card.stackLabel}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', padding: '0 64px 48px' }}>
        <BrandFooter logoDataUri={logoDataUri} />
      </div>
    </div>
  )
}

/**
 * Render a 1200x630 social preview PNG. Remote images (avatars, Twemoji) are
 * best-effort with aggressive timeouts — every failure degrades to an
 * initials/letter tile instead of failing the render.
 */
export async function renderGroupCardPng(
  input: GroupCardInput,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const [{ default: satori }, { Resvg }, fonts, logoDataUri] =
    await Promise.all([
      import('satori'),
      import('@resvg/resvg-js'),
      loadOgFonts(),
      loadOgLogo(),
    ])

  const resolveAvatars = async (
    avatars: GroupCardAvatar[],
  ): Promise<ResolvedAvatar[]> =>
    Promise.all(
      avatars.map(async (avatar) => ({
        initials: initialsFor(avatar.name),
        dataUri: avatar.imageUrl
          ? await fetchImageAsDataUri(avatar.imageUrl, fetchImpl)
          : null,
      })),
    )

  let card: ResolvedCard
  if (input.kind === 'fallback') {
    card = { kind: 'fallback', note: input.note }
  } else if (input.kind === 'friend-invite') {
    const [inviter] = await resolveAvatars([
      { name: input.inviterName, imageUrl: input.inviterImageUrl },
    ])
    card = {
      kind: 'friend',
      eyebrow: 'SPLIIT CLOUD · FRIEND INVITE',
      title:
        input.inviterName.trim() !== ''
          ? `Friend ledger with ${input.inviterName.trim().slice(0, 60)}`
          : 'Friend ledger invitation',
      subtitle:
        input.temporaryName?.trim() !== '' && input.temporaryName !== null
          ? `Invited by ${input.inviterName || 'someone'} · You'll join as ${input.temporaryName!.trim().slice(0, 40)}`
          : `Invited by ${input.inviterName || 'someone'}`,
      pills:
        input.currencyCode?.trim() !== '' && input.currencyCode !== null
          ? [input.currencyCode.trim().slice(0, 8)]
          : [],
      avatars: [
        inviter ?? { initials: '?', dataUri: null },
        {
          initials: initialsFor(input.temporaryName),
          dataUri: null,
        },
      ],
      accent: PRIMARY,
    }
  } else {
    const title =
      input.groupName.trim() !== ''
        ? input.groupName.trim().slice(0, 80)
        : 'Group invitation'
    // Standard palette ids (e.g. 'teal') resolve via the shared
    // group-appearance mapping; custom hex passes through. Unknown values
    // fall back to the brand primary.
    const accent = resolveGroupColorHex(input.color) ?? PRIMARY
    const pills = [memberLabel(input.memberCount)]
    if (input.currencyCode?.trim()) {
      pills.push(input.currencyCode.trim().slice(0, 8))
    }
    const avatars = await resolveAvatars(input.avatars.slice(0, 3))
    const subtitle =
      input.kind === 'group-invite'
        ? input.temporaryName?.trim()
          ? `Invited by ${input.inviterName || 'someone'} · You'll join as ${input.temporaryName.trim().slice(0, 40)}`
          : `Invited by ${input.inviterName || 'someone'}`
        : 'Shared read-only view'
    card = {
      kind: 'group',
      eyebrow:
        input.kind === 'group-invite'
          ? 'SPLIIT CLOUD · GROUP INVITE'
          : 'SPLIIT CLOUD · SHARED VIEW',
      title,
      subtitle,
      pills,
      tile: {
        emojiUri: (await fetchEmojiImage(input.emoji, fetchImpl)).dataUri,
        fallbackLetter: (firstGrapheme(title.trim()) || '?').toUpperCase(),
      },
      avatars,
      stackLabel: avatarStackLabel(
        input.avatars.map((avatar) => avatar.name),
        input.memberCount,
      ),
      accent,
    }
  }

  const svg = await satori(
    <CardElement card={card} logoDataUri={logoDataUri} />,
    {
      width: OG_CARD_WIDTH,
      height: OG_CARD_HEIGHT,
      fonts,
    },
  )
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_CARD_WIDTH },
  })
    .render()
    .asPng()
}
