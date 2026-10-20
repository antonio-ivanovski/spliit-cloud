/** Default join cap for general-purpose shared (multi-person) links. */
export const SHARED_LINK_DEFAULT_MAX_USES = null

/** Default expiry for general-purpose shared links. 7 days. */
export const SHARED_LINK_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Hard bounds on a shared link's join cap. Null means unlimited. */
export const SHARED_LINK_MIN_USES = 2
export const SHARED_LINK_MAX_USES_LIMIT = 1000

/**
 * Hard bound on a shared link's expiry. Computed server-side from a client
 * duration; null means never expires.
 */
export const SHARED_LINK_MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000
export const SHARED_LINK_MIN_TTL_MS = 60 * 60 * 1000

/** Max unrevoked pending shared links per group, including ended links. */
export const SHARED_LINK_MAX_PENDING_PER_GROUP = 10

/** Max label length for a shared link. */
export const SHARED_LINK_LABEL_MAX_LENGTH = 40
