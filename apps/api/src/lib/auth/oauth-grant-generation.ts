import { createHash, randomUUID } from 'node:crypto'

import { Prisma, prisma } from '@spliit/db'

type TransactionClient = Prisma.TransactionClient

/**
 * Monotonic authorization generation per (account, client) pair.
 *
 * Timestamps cannot distinguish authorization generations: Better Auth mints
 * authorization codes with second-precision `createdAt`, so a code created
 * after a revocation can share its whole second with the revocation itself.
 * This module instead binds every grant to an integer generation that only
 * moves forward:
 *
 * - Disconnect (`revokeAuthorizedClient`) increments the pair's generation.
 *   Reconnect never increments and never deletes the counter, so work from an
 *   earlier generation stays distinguishable forever.
 * - The generation active when an authorization starts is captured and carried
 *   through the authorization code (`grantGeneration` on the code's
 *   verification value), the refresh-token family (a family row keyed by the
 *   code identifier), and every access token (a binding row keyed by the JWT
 *   `jti`).
 * - Token exchange rejects codes and refresh tokens from an older generation;
 *   bearer authentication rejects access tokens bound to an older generation.
 *   All checks read the database, so they hold across API replicas.
 *
 * Rows live in `Verification` so no schema change is required. Generation
 * counters never expire; family rows never expire either (refresh rotation
 * keeps families alive indefinitely, so an expiry would orphan them — see
 * `recordRefreshFamilyGeneration`). Token bindings expire with the grant they
 * describe and are best-effort: a missing binding on a pair with revocation
 * history is rejected rather than trusted.
 */

/**
 * Stable subject identifying an (account, client) pair. Shared by the
 * generation counter, the revocation barrier, and the token-binding prefix so
 * exact bearer lookups and prefix listings address the same pair.
 */
export function oauthPairSubject(accountId: string, clientId: string): string {
  return createHash('sha256')
    .update(accountId)
    .update('\0')
    .update(clientId)
    .digest('base64url')
}

const GENERATION_PREFIX = 'spliit:oauth-generation:'
const FAMILY_PREFIX = 'spliit:oauth-family:'
const JTI_PREFIX = 'spliit:oauth-jti:'
const NEVER_EXPIRES = new Date('9999-12-31T23:59:59.999Z')
/** Bounded CAS retries for concurrent disconnects before surfacing. */
const MAX_INCREMENT_ATTEMPTS = 5

export function oauthGrantGenerationIdentifier(
  accountId: string,
  clientId: string,
): string {
  return `${GENERATION_PREFIX}${oauthPairSubject(accountId, clientId)}`
}

/**
 * Deterministic primary key for a pair's generation counter row.
 *
 * `Verification.identifier` is only indexed, not unique, so two concurrent
 * first-disconnects could both observe "no row" and each create generation 1 —
 * losing an increment. The primary key _is_ unique, so creating with a
 * deterministic id turns that race into arbitration: exactly one transaction
 * wins the create, the loser gets P2002 and retries onto the winner's row.
 */
export function oauthGrantGenerationRowId(
  accountId: string,
  clientId: string,
): string {
  return `spliit-oauth-generation-row-${oauthPairSubject(accountId, clientId)}`
}

export function oauthRefreshFamilyIdentifier(
  authorizationCodeId: string,
): string {
  return `${FAMILY_PREFIX}${authorizationCodeId}`
}

export function oauthAccessTokenBindingIdentifier(
  accountId: string,
  clientId: string,
  jti: string,
): string {
  return `${JTI_PREFIX}${oauthPairSubject(accountId, clientId)}:${jti}`
}

/** Prefix addressing every live binding of one pair (for settings display). */
export function oauthAccessTokenBindingPrefix(
  accountId: string,
  clientId: string,
): string {
  return `${JTI_PREFIX}${oauthPairSubject(accountId, clientId)}:`
}

/** Pre-pair-prefix identifier, kept as a read fallback until old rows expire. */
function oauthAccessTokenBindingLegacyIdentifier(jti: string): string {
  return `${JTI_PREFIX}${jti}`
}

function parseGeneration(value: string): number | null {
  try {
    const parsed = JSON.parse(value) as { generation?: unknown }
    return typeof parsed.generation === 'number' &&
      Number.isInteger(parsed.generation) &&
      parsed.generation >= 0
      ? parsed.generation
      : null
  } catch {
    return null
  }
}

/** Current generation for the pair. Zero when nothing was ever revoked. */
export async function getGrantGeneration(
  accountId: string,
  clientId: string,
): Promise<number> {
  const row = await prisma.verification.findFirst({
    where: { identifier: oauthGrantGenerationIdentifier(accountId, clientId) },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })
  return (row && parseGeneration(row.value)) ?? 0
}

/**
 * Move the pair to the next generation. Called exactly once per disconnect,
 * after the revocation barrier transaction has committed, so a retry of a
 * failed revocation stays fail-closed (the barrier stands) and monotonic.
 *
 * Concurrent disconnects arbitrate without losing increments: the counter row
 * has a deterministic primary key (see `oauthGrantGenerationRowId`), and every
 * attempt runs in its own transaction — a lost create race rolls its attempt
 * back (a unique violation would poison a shared transaction on Postgres) and
 * the next attempt increments on top of the winner's row. The update itself is
 * compare-and-swap on the previously read value. No delete-and-recreate gap
 * ever exposes a missing row to a concurrent bearer check.
 */
export async function incrementGrantGeneration(
  accountId: string,
  clientId: string,
): Promise<number> {
  for (let attempt = 0; attempt < MAX_INCREMENT_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction((tx) =>
        incrementGrantGenerationOnce(tx, accountId, clientId),
      )
    } catch (error) {
      if (!isRetryableGenerationRace(error)) throw error
    }
  }
  throw new Error(
    `[oauth] could not increment grant generation for pair after ${MAX_INCREMENT_ATTEMPTS} attempts`,
  )
}

/** Lost the arbitration: another transaction created or moved the row first. */
class GrantGenerationRaceError extends Error {}

/** Single increment attempt inside one transaction. */
async function incrementGrantGenerationOnce(
  tx: TransactionClient,
  accountId: string,
  clientId: string,
): Promise<number> {
  const identifier = oauthGrantGenerationIdentifier(accountId, clientId)
  const rowId = oauthGrantGenerationRowId(accountId, clientId)
  // Serialize concurrent disconnects for one pair in the database instead of
  // retry-storming: the advisory lock is transaction-scoped (released on
  // commit/rollback) and keyed by the row id, so unrelated pairs never block
  // each other. The compare-and-swap below stays as a second line of defense.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rowId}, 0))`
  const existing = await tx.verification.findUnique({
    where: { id: rowId },
    select: { value: true },
  })
  if (!existing) {
    // Adopt the highest generation from any pre-deterministic row so an
    // old counter is never reset by the id migration.
    const legacy = await tx.verification.findFirst({
      where: { identifier },
      orderBy: { createdAt: 'desc' },
      select: { value: true },
    })
    const next = ((legacy && parseGeneration(legacy.value)) ?? 0) + 1
    try {
      const now = new Date()
      await tx.verification.create({
        data: {
          id: rowId,
          identifier,
          value: JSON.stringify({
            type: 'spliit_oauth_generation',
            generation: next,
          }),
          createdAt: now,
          updatedAt: now,
          expiresAt: NEVER_EXPIRES,
        },
      })
      return next
    } catch (error) {
      // Lost the create race: another transaction won the row. Retry the
      // whole attempt in a fresh transaction.
      if (!isUniqueViolation(error)) throw error
      throw new GrantGenerationRaceError()
    }
  }
  const next = (parseGeneration(existing.value) ?? 0) + 1
  const updated = await tx.verification.updateMany({
    where: { id: rowId, value: existing.value },
    data: {
      value: JSON.stringify({
        type: 'spliit_oauth_generation',
        generation: next,
      }),
      updatedAt: new Date(),
    },
  })
  if (updated.count === 1) return next
  // Lost the update race: another transaction moved the counter first.
  throw new GrantGenerationRaceError()
}

function isRetryableGenerationRace(error: unknown): boolean {
  return error instanceof GrantGenerationRaceError
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

/** Generation stamped on an authorization code value, if it carries one. */
export function codeGrantGeneration(codeValue: string): number | null {
  try {
    const parsed = JSON.parse(codeValue) as { grantGeneration?: unknown }
    return typeof parsed.grantGeneration === 'number' &&
      Number.isInteger(parsed.grantGeneration) &&
      parsed.grantGeneration >= 0
      ? parsed.grantGeneration
      : null
  } catch {
    return null
  }
}

/**
 * Stamp freshly created authorization codes with the generation that was active
 * when their authorization started. Must be called with the _start_ generation,
 * never the current one: a code whose creation was paused across a revocation
 * keeps its old stamp and is rejected at exchange.
 */
export async function tagAuthorizationCodesWithGeneration(
  authorizationCodeId: string,
  generation: number,
): Promise<void> {
  const rows = await prisma.verification.findMany({
    where: { identifier: authorizationCodeId },
    select: { id: true, value: true },
  })
  for (const row of rows) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(row.value) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof parsed.grantGeneration === 'number') continue
    await prisma.verification.update({
      where: { id: row.id },
      data: {
        value: JSON.stringify({ ...parsed, grantGeneration: generation }),
      },
    })
  }
}

/**
 * Record the generation a refresh-token family was born with.
 *
 * The row never expires: refresh rotation keeps families alive indefinitely
 * (each renewal issues a fresh 30-day refresh token), so any expiry would
 * orphan a live family and — on a pair with revocation history — wrongly reject
 * its next refresh as unbound. Rows are deleted when the family is revoked (see
 * `deleteRefreshFamilyGenerations`), so the table grows with the number of
 * grants ever authorized, not with time.
 */
export async function recordRefreshFamilyGeneration(
  authorizationCodeId: string,
  generation: number,
): Promise<void> {
  const identifier = oauthRefreshFamilyIdentifier(authorizationCodeId)
  const now = new Date()
  await prisma.verification.deleteMany({ where: { identifier } })
  await prisma.verification.create({
    data: {
      id: randomUUID(),
      identifier,
      value: JSON.stringify({
        type: 'spliit_oauth_family',
        generation,
      }),
      createdAt: now,
      updatedAt: now,
      expiresAt: NEVER_EXPIRES,
    },
  })
}

/** Forget family bindings whose refresh family was permanently revoked. */
export async function deleteRefreshFamilyGenerations(
  tx: TransactionClient,
  authorizationCodeIds: string[],
): Promise<void> {
  if (authorizationCodeIds.length === 0) return
  await tx.verification.deleteMany({
    where: {
      identifier: {
        in: authorizationCodeIds.map(oauthRefreshFamilyIdentifier),
      },
    },
  })
}

/** Generation a refresh-token family was born with, if recorded. */
export async function getRefreshFamilyGeneration(
  authorizationCodeId: string | null,
): Promise<number | null> {
  if (!authorizationCodeId) return null
  const row = await prisma.verification.findFirst({
    where: {
      identifier: oauthRefreshFamilyIdentifier(authorizationCodeId),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })
  return row ? parseGeneration(row.value) : null
}

/** Decode a JWT payload without verifying, to find its `jti` after verify. */
export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    const json = Buffer.from(
      segment.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export type AccessTokenBinding = {
  accountId: string
  clientId: string
  generation: number
  /** Scopes the token was issued with, for connected-app display. */
  scopes: string[]
}

/**
 * Bind an issued access token (`jti`) to the generation it was born with.
 *
 * The identifier embeds the pair subject so `listAccessTokenBindings` can
 * enumerate a pair's live bindings while bearer validation still does an exact
 * lookup. Rows expire with the token itself.
 */
export async function recordAccessTokenBinding(
  accountId: string,
  clientId: string,
  jti: string,
  binding: AccessTokenBinding,
  expiresAt: Date,
): Promise<void> {
  const identifier = oauthAccessTokenBindingIdentifier(accountId, clientId, jti)
  const now = new Date()
  await prisma.verification.deleteMany({ where: { identifier } })
  await prisma.verification.create({
    data: {
      id: randomUUID(),
      identifier,
      value: JSON.stringify({ type: 'spliit_oauth_jti', ...binding }),
      createdAt: now,
      updatedAt: now,
      expiresAt,
    },
  })
}

function parseAccessTokenBinding(value: string): AccessTokenBinding | null {
  try {
    const parsed = JSON.parse(value) as {
      accountId?: unknown
      clientId?: unknown
      generation?: unknown
      scopes?: unknown
    }
    if (
      typeof parsed.accountId !== 'string' ||
      typeof parsed.clientId !== 'string'
    ) {
      return null
    }
    const generation =
      typeof parsed.generation === 'number' &&
      Number.isInteger(parsed.generation) &&
      parsed.generation >= 0
        ? parsed.generation
        : null
    if (generation === null) return null
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes.filter(
          (scope): scope is string => typeof scope === 'string',
        )
      : []
    return {
      accountId: parsed.accountId,
      clientId: parsed.clientId,
      generation,
      scopes,
    }
  } catch {
    return null
  }
}

/** Generation an access token was born with, if recorded. */
export async function getAccessTokenBinding(
  accountId: string,
  clientId: string,
  jti: string,
): Promise<AccessTokenBinding | null> {
  const row = await prisma.verification.findFirst({
    where: {
      identifier: oauthAccessTokenBindingIdentifier(accountId, clientId, jti),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })
  if (row) return parseAccessTokenBinding(row.value)
  // Tokens bound before pair-prefixed identifiers shipped expire within the
  // hour; keep reading the old shape until they are gone.
  const legacy = await prisma.verification.findFirst({
    where: {
      identifier: oauthAccessTokenBindingLegacyIdentifier(jti),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })
  return legacy ? parseAccessTokenBinding(legacy.value) : null
}

export type LiveAccessTokenBinding = AccessTokenBinding & {
  expiresAt: Date
}

/**
 * A pair's unexpired token bindings, newest first. Bearer validation never uses
 * this (it does exact lookups); connected-app settings unions these scopes so
 * access-only grants — which create no refresh-token row — still show up with
 * their effective permissions. Callers must filter by the current generation:
 * older bindings describe revoked grants.
 */
export async function listAccessTokenBindings(
  accountId: string,
  clientId: string,
): Promise<LiveAccessTokenBinding[]> {
  const rows =
    (await prisma.verification.findMany({
      where: {
        identifier: {
          startsWith: oauthAccessTokenBindingPrefix(accountId, clientId),
        },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { value: true, expiresAt: true },
    })) ?? []
  const bindings: LiveAccessTokenBinding[] = []
  for (const row of rows) {
    const binding = parseAccessTokenBinding(row.value)
    if (
      !binding ||
      binding.accountId !== accountId ||
      binding.clientId !== clientId
    ) {
      continue
    }
    bindings.push({ ...binding, expiresAt: row.expiresAt })
  }
  return bindings
}

/** Forget a pair's token bindings (e.g. on disconnect; rows expire anyway). */
export async function deleteAccessTokenBindings(
  tx: TransactionClient,
  accountId: string,
  clientId: string,
): Promise<void> {
  await tx.verification.deleteMany({
    where: {
      identifier: {
        startsWith: oauthAccessTokenBindingPrefix(accountId, clientId),
      },
    },
  })
}
