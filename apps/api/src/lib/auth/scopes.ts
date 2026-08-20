/**
 * OAuth scopes for programmatic clients.
 *
 * Scopes are split by resource and verb so a caller can be granted exactly what
 * it needs. Destructive verbs live in their own scopes and are never part of
 * the default grant: a client that asks for nothing in particular can read and
 * write, but cannot delete.
 */

/** Scopes required by the OpenID Connect authorization code flow. */
export const OIDC_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
] as const

export const SPLIIT_SCOPES = {
  groupsRead: 'spliit:groups:read',
  groupsWrite: 'spliit:groups:write',
  groupsDelete: 'spliit:groups:delete',
  expensesRead: 'spliit:expenses:read',
  expensesWrite: 'spliit:expenses:write',
  expensesDelete: 'spliit:expenses:delete',
} as const

export type SpliitScope = (typeof SPLIIT_SCOPES)[keyof typeof SPLIIT_SCOPES]

/** Scopes that allow irreversible changes. Always opt-in. */
export const DESTRUCTIVE_SCOPES: readonly SpliitScope[] = [
  SPLIIT_SCOPES.groupsDelete,
  SPLIIT_SCOPES.expensesDelete,
]

/** Every scope the provider recognises, including the OIDC set. */
export const ALL_SCOPES: readonly string[] = [
  ...OIDC_SCOPES,
  ...Object.values(SPLIIT_SCOPES),
]

/**
 * Granted to a client that registers without requesting specific scopes. Read
 * and write only — see `DESTRUCTIVE_SCOPES`.
 */
export const DEFAULT_CLIENT_SCOPES: readonly string[] = ALL_SCOPES.filter(
  (scope) => !DESTRUCTIVE_SCOPES.includes(scope as SpliitScope),
)

/**
 * The `spliit:expenses:write` scope predates the read/write split and was the
 * only write scope the MCP assistant ever requested. Tokens minted before this
 * change carry it without `spliit:expenses:read`, so treat write as implying
 * read for both resources rather than breaking live integrations.
 */
const IMPLIED_SCOPES: Readonly<Record<string, readonly SpliitScope[]>> = {
  [SPLIIT_SCOPES.expensesWrite]: [SPLIIT_SCOPES.expensesRead],
  [SPLIIT_SCOPES.groupsWrite]: [SPLIIT_SCOPES.groupsRead],
  [SPLIIT_SCOPES.expensesDelete]: [SPLIIT_SCOPES.expensesRead],
  [SPLIIT_SCOPES.groupsDelete]: [SPLIIT_SCOPES.groupsRead],
}

/** Expand a granted scope list with the scopes those grants imply. */
export function expandScopes(granted: readonly string[]): Set<string> {
  const expanded = new Set(granted)
  for (const scope of granted) {
    for (const implied of IMPLIED_SCOPES[scope] ?? []) expanded.add(implied)
  }
  return expanded
}

/** Whether a granted scope list satisfies `required`. */
export function hasScope(
  granted: readonly string[],
  required: SpliitScope,
): boolean {
  return expandScopes(granted).has(required)
}
