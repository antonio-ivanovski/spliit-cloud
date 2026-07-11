export type AccountIdentity = {
  id: string
  name?: string | null
  image?: string | null
}

/** Whether an account still needs a usable display name. */
export function needsDisplayName(account: {
  name?: string | null
  email?: string | null
}): boolean {
  return !account.name || account.name === account.email
}
