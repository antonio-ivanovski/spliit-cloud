import type { PersonalProfile, Prisma } from '@spliit/db'
import { prisma } from '@spliit/db'

import { env } from '../env'

type ProfileClient = Prisma.TransactionClient | typeof prisma

/**
 * The personal workspace is created lazily on first visit. Currency defaults to
 * the account's display currency, then the instance default. The currency is
 * locked once any personal data exists (checked by the update path) so
 * historical amounts never silently change meaning.
 */
export async function ensurePersonalProfile(
  accountId: string,
  client: ProfileClient = prisma,
): Promise<PersonalProfile> {
  const existing = await client.personalProfile.findUnique({
    where: { accountId },
  })
  if (existing) return existing

  const preference = await client.accountPreference.findUnique({
    where: { accountId },
    select: { defaultCurrencyCode: true, timeZone: true },
  })

  return client.personalProfile.upsert({
    where: { accountId },
    update: {},
    create: {
      accountId,
      currencyCode:
        preference?.defaultCurrencyCode ?? env.PUBLIC_DEFAULT_CURRENCY_CODE,
      timeZone: preference?.timeZone ?? 'UTC',
    },
  })
}

export async function personalHasData(
  accountId: string,
  client: ProfileClient = prisma,
): Promise<boolean> {
  const [transactions, budgets, series] = await Promise.all([
    client.personalTransaction.count({ where: { accountId } }),
    client.personalBudget.count({ where: { accountId } }),
    client.personalRecurringSeries.count({ where: { accountId } }),
  ])
  return transactions > 0 || budgets > 0 || series > 0
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/** Calendar date of an instant in the given IANA zone, as a UTC midnight. */
export function dateOnlyInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return new Date(
    Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))),
  )
}
