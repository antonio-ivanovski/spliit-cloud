import { dateOnlyInTimeZone } from '@spliit/domain'

/** Return the ledger calendar date through which a catch-up batch may run. */
export function catchUpDueThrough(now: Date, timeZone: string): string {
  return dateOnlyInTimeZone(now, timeZone).toISOString().slice(0, 10)
}
