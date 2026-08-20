import { Database, PencilLine, PlusCircle, Receipt, Trash2 } from 'lucide-react'

/**
 * How each scope is presented on the consent screen.
 *
 * Every scope the provider can issue has an entry. A scope with no entry is
 * treated as unknown and blocks approval outright, so a permission can never be
 * granted without being shown.
 */
const SCOPE_GRANTS = [
  {
    scope: 'spliit:groups:read',
    icon: Database,
    titleKey: 'groupsTitle',
    descriptionKey: 'groupsDescription',
  },
  {
    scope: 'spliit:groups:manage',
    icon: PencilLine,
    titleKey: 'groupsManageTitle',
    descriptionKey: 'groupsManageDescription',
  },
  {
    scope: 'spliit:groups:delete',
    icon: Trash2,
    titleKey: 'groupsDeleteTitle',
    descriptionKey: 'groupsDeleteDescription',
  },
  {
    scope: 'spliit:expenses:read',
    icon: Receipt,
    titleKey: 'expensesReadTitle',
    descriptionKey: 'expensesReadDescription',
  },
  {
    scope: 'spliit:expenses:manage',
    icon: PencilLine,
    titleKey: 'expensesManageTitle',
    descriptionKey: 'expensesManageDescription',
  },
  {
    scope: 'spliit:expenses:delete',
    icon: Trash2,
    titleKey: 'expensesDeleteTitle',
    descriptionKey: 'expensesDeleteDescription',
  },
  {
    // Predates the direct-access scopes: creation goes through a preview and a
    // confirmation token, which is what the description promises.
    scope: 'spliit:expenses:write',
    icon: PlusCircle,
    titleKey: 'expensesTitle',
    descriptionKey: 'expensesDescription',
  },
] as const

type ScopeGrant = (typeof SCOPE_GRANTS)[number]

export const KNOWN_SCOPES: ReadonlySet<string> = new Set(
  SCOPE_GRANTS.map((grant) => grant.scope),
)

/** Carry no Spliit permission of their own; identity is always shown. */
export const OIDC_SCOPES: ReadonlySet<string> = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
])

/** The grants to render, in a stable order regardless of request order. */
export function describeScopes(
  requested: readonly string[],
): readonly ScopeGrant[] {
  const asked: ReadonlySet<string> = new Set(requested)
  return SCOPE_GRANTS.filter((grant) => asked.has(grant.scope))
}
