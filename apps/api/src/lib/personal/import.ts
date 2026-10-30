import { TRPCError } from '@trpc/server'

import { prisma, type Prisma } from '@spliit/db'
import {
  convertMinorUnitsByRate,
  exchangeRateLookupDate,
  supportedCurrencyCodes,
} from '@spliit/domain'

import { createManyInBatches } from '../api/create-many-in-batches'
import { randomId } from '../api/shared'
import {
  getCurrencyRates,
  type BatchRateRequest,
  type CurrencyRate,
} from '../currency-rates'
import {
  externalIdentityHash,
  fuzzyImportMatchKey,
  importDateWindows,
  normalizedImportTitle,
  storedImportKey,
  type ImportMatchIdentity,
} from '../import/identity'
import { ensurePersonalProfile, parseIsoDate } from './profile'

export const PERSONAL_FILE_IMPORT_PROVIDER = 'GENERIC_CSV'
const PERSONAL_FILE_IMPORT_KEY_DOMAIN = 'spliit:personal-file-import:v1'

export type PersonalFileImportRow = {
  rowId: string
  rowNumber: number
  source: {
    baseFingerprint: string
    originFingerprint: string
  }
  externalId?: string | null
  sourceAccount?: string | null
  entry: {
    kind: 'EXPENSE' | 'INCOME'
    amount: number
    currencyCode?: string | null
    date: string
    categoryId: string
    title?: string | null
    note?: string | null
  }
  approvedDuplicateKeys?: string[]
}

export type PersonalFileImportMatchKind =
  | 'EXACT_IMPORT'
  | 'EXISTING_TRANSACTION'
  | 'CURRENT_FILE'

export type PersonalFileImportMatch = {
  key: string
  kind: PersonalFileImportMatchKind
  transactionId: string | null
  sourceRowId: string | null
  title: string | null
  date: string | null
  amount: number | null
  currency: string | null
  /** Set when the matched stored row is a linked GROUP entry. */
  source: 'PERSONAL' | 'GROUP' | null
}

export type PersonalFileImportDuplicateResult = {
  rowId: string
  rowNumber: number
  matches: PersonalFileImportMatch[]
}

export class PersonalFileImportDuplicateError extends Error {
  constructor(
    readonly conflicts: Array<{
      rowId: string
      rowNumber: number
      matchKeys: string[]
    }>,
  ) {
    super(
      `Some selected rows have new or unapproved duplicate matches (rows ${conflicts
        .map((conflict) => conflict.rowNumber)
        .join(', ')}). Review them and retry.`,
    )
    this.name = 'PersonalFileImportDuplicateError'
  }
}

type DbClient = Prisma.TransactionClient | typeof prisma

type ExistingTransactionCandidate = {
  id: string
  title: string | null
  date: Date
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  source: 'PERSONAL' | 'GROUP'
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function candidateDateIso(candidate: ExistingTransactionCandidate): string {
  return toIsoDate(candidate.date)
}

function rowIdentity(
  row: PersonalFileImportRow,
  profileCurrencyCode: string,
): ImportMatchIdentity {
  return {
    date: row.entry.date,
    amount: row.entry.amount,
    currency: (
      row.entry.currencyCode?.trim() || profileCurrencyCode
    ).toUpperCase(),
    title: row.entry.title ?? '',
  }
}

function candidateMatchKeys(
  candidate: ExistingTransactionCandidate,
  profileCurrencyCode: string,
): string[] {
  const date = candidateDateIso(candidate)
  const title = candidate.title ?? ''
  const keys: string[] = []
  const profileCurrency = profileCurrencyCode.toUpperCase()
  keys.push(
    fuzzyImportMatchKey({
      date,
      amount: candidate.amount,
      currency: profileCurrency,
      title,
    }),
  )
  if (candidate.originalAmount != null && candidate.originalCurrency) {
    keys.push(
      fuzzyImportMatchKey({
        date,
        amount: candidate.originalAmount,
        currency: candidate.originalCurrency.toUpperCase(),
        title,
      }),
    )
  }
  return keys
}

function candidateMatches(
  candidate: ExistingTransactionCandidate,
  identity: ImportMatchIdentity,
  profileCurrencyCode: string,
): boolean {
  if (candidateDateIso(candidate) !== identity.date) return false
  const profileCurrency = profileCurrencyCode.toUpperCase()
  const amountAndCurrencyMatch =
    (identity.currency === profileCurrency &&
      candidate.amount === identity.amount) ||
    (candidate.originalAmount === identity.amount &&
      candidate.originalCurrency?.toUpperCase() === identity.currency)
  return (
    amountAndCurrencyMatch &&
    normalizedImportTitle(candidate.title ?? '') ===
      normalizedImportTitle(identity.title)
  )
}

function existingMatch(
  candidate: ExistingTransactionCandidate,
  kind: 'EXACT_IMPORT' | 'EXISTING_TRANSACTION',
  profileCurrencyCode: string,
): PersonalFileImportMatch {
  return {
    key: `${kind}:${candidate.id}`,
    kind,
    transactionId: candidate.id,
    sourceRowId: null,
    title: candidate.title,
    date: candidateDateIso(candidate),
    amount: candidate.originalAmount ?? candidate.amount,
    currency:
      candidate.originalCurrency?.toUpperCase() ??
      profileCurrencyCode.toUpperCase(),
    source: candidate.source,
  }
}

function storedPersonalImportKey(
  accountId: string,
  originFingerprint: string,
): string {
  return storedImportKey(
    PERSONAL_FILE_IMPORT_KEY_DOMAIN,
    accountId,
    originFingerprint,
  )
}

export async function findPersonalFileImportDuplicates(
  accountId: string,
  profileCurrencyCode: string,
  rows: PersonalFileImportRow[],
  client: DbClient = prisma,
): Promise<{ rows: PersonalFileImportDuplicateResult[] }> {
  if (rows.length === 0) return { rows: [] }

  const keys = rows.map((row) =>
    storedPersonalImportKey(accountId, row.source.originFingerprint),
  )
  const imported = await client.personalFileImportSource.findMany({
    where: {
      accountId,
      provider: PERSONAL_FILE_IMPORT_PROVIDER,
      importKey: { in: keys },
    },
    select: {
      importKey: true,
      personalTransaction: {
        select: {
          id: true,
          title: true,
          date: true,
          amount: true,
          originalAmount: true,
          originalCurrency: true,
          source: true,
        },
      },
    },
  })
  const importedByKey = new Map<string, ExistingTransactionCandidate[]>()
  for (const { importKey, personalTransaction: candidate } of imported) {
    const list = importedByKey.get(importKey) ?? []
    list.push(candidate)
    importedByKey.set(importKey, list)
  }

  const externalHashes = [
    ...new Set(
      rows
        .map((row) => externalIdentityHash(row.externalId, row.sourceAccount))
        .filter((hash): hash is string => hash !== null),
    ),
  ]
  const importedByExternalHash = new Map<
    string,
    ExistingTransactionCandidate[]
  >()
  if (externalHashes.length > 0) {
    const externalMatches = await client.personalFileImportSource.findMany({
      where: {
        accountId,
        provider: PERSONAL_FILE_IMPORT_PROVIDER,
        externalIdentityHash: { in: externalHashes },
      },
      select: {
        externalIdentityHash: true,
        personalTransaction: {
          select: {
            id: true,
            title: true,
            date: true,
            amount: true,
            originalAmount: true,
            originalCurrency: true,
            source: true,
          },
        },
      },
    })
    for (const {
      externalIdentityHash: hash,
      personalTransaction,
    } of externalMatches) {
      if (!hash) continue
      const list = importedByExternalHash.get(hash) ?? []
      list.push(personalTransaction)
      importedByExternalHash.set(hash, list)
    }
  }

  const identities = rows.map((row) => rowIdentity(row, profileCurrencyCode))
  const wantedIdentities = new Set(
    identities.map((identity) => fuzzyImportMatchKey(identity)),
  )
  const candidatesByIdentity = new Map<string, ExistingTransactionCandidate[]>()
  const DUPLICATE_CANDIDATE_PAGE_SIZE = 1000
  const wantedAmounts = [...new Set(identities.map(({ amount }) => amount))]
  const windows = importDateWindows(identities.map(({ date }) => date))
  const candidateSelect = {
    id: true,
    title: true,
    date: true,
    amount: true,
    originalAmount: true,
    originalCurrency: true,
    source: true,
  } as const
  for (const bounds of windows) {
    let cursor: { date: Date; id: string } | null = null
    for (;;) {
      const page: ExistingTransactionCandidate[] =
        await client.personalTransaction.findMany({
          where: {
            accountId,
            date: { gte: bounds.gte, lt: bounds.lt },
            OR: [
              { amount: { in: wantedAmounts } },
              { originalAmount: { in: wantedAmounts } },
            ],
            ...(cursor
              ? {
                  OR: [
                    { date: { gt: cursor.date } },
                    { date: cursor.date, id: { gt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          take: DUPLICATE_CANDIDATE_PAGE_SIZE,
          select: candidateSelect,
        })
      if (page.length === 0) break
      for (const candidate of page) {
        for (const key of candidateMatchKeys(candidate, profileCurrencyCode)) {
          if (!wantedIdentities.has(key)) continue
          const list = candidatesByIdentity.get(key) ?? []
          list.push(candidate)
          candidatesByIdentity.set(key, list)
        }
      }
      if (page.length < DUPLICATE_CANDIDATE_PAGE_SIZE) break
      const last = page[page.length - 1]!
      cursor = { date: last.date, id: last.id }
    }
  }

  const firstRowByBaseFingerprint = new Map<string, string>()
  const resultRows = rows.map((row, index) => {
    const matches: PersonalFileImportMatch[] = []
    const seenIds = new Set<string>()
    for (const candidate of importedByKey.get(keys[index]!) ?? []) {
      matches.push(
        existingMatch(candidate, 'EXACT_IMPORT', profileCurrencyCode),
      )
      seenIds.add(candidate.id)
    }
    const externalHash = externalIdentityHash(row.externalId, row.sourceAccount)
    if (externalHash) {
      for (const candidate of importedByExternalHash.get(externalHash) ?? []) {
        if (seenIds.has(candidate.id)) continue
        matches.push(
          existingMatch(candidate, 'EXACT_IMPORT', profileCurrencyCode),
        )
        seenIds.add(candidate.id)
      }
    }
    for (const candidate of candidatesByIdentity.get(
      fuzzyImportMatchKey(identities[index]!),
    ) ?? []) {
      if (
        seenIds.has(candidate.id) ||
        !candidateMatches(candidate, identities[index]!, profileCurrencyCode)
      ) {
        continue
      }
      matches.push(
        existingMatch(candidate, 'EXISTING_TRANSACTION', profileCurrencyCode),
      )
      seenIds.add(candidate.id)
    }

    const firstRowId = firstRowByBaseFingerprint.get(row.source.baseFingerprint)
    if (firstRowId) {
      matches.push({
        key: `CURRENT_FILE:${firstRowId}`,
        kind: 'CURRENT_FILE',
        transactionId: null,
        sourceRowId: firstRowId,
        title: null,
        date: null,
        amount: null,
        currency: null,
        source: null,
      })
    } else {
      firstRowByBaseFingerprint.set(row.source.baseFingerprint, row.rowId)
    }

    return { rowId: row.rowId, rowNumber: row.rowNumber, matches }
  })
  return { rows: resultRows }
}

type ResolvedRowConversion = {
  ledgerAmountMinor: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: 'EXCHANGE' | null
}

async function resolvePersonalConversions(
  profileCurrency: string,
  rows: PersonalFileImportRow[],
): Promise<ResolvedRowConversion[]> {
  const needsExchange = rows.filter((row) => {
    const code = (
      row.entry.currencyCode?.trim() || profileCurrency
    ).toUpperCase()
    return code !== profileCurrency.toUpperCase()
  })
  const requests: BatchRateRequest[] = []
  const requestKeys = new Set<string>()
  for (const row of needsExchange) {
    const base = (
      row.entry.currencyCode?.trim() || profileCurrency
    ).toUpperCase()
    const target = profileCurrency.toUpperCase()
    if (
      !(supportedCurrencyCodes as readonly string[]).includes(base) ||
      !(supportedCurrencyCodes as readonly string[]).includes(target)
    ) {
      continue
    }
    const date = exchangeRateLookupDate(row.entry.date)
    const key = `${date}|${base}|${target}`
    if (!requestKeys.has(key)) {
      requestKeys.add(key)
      requests.push({ date, base, target })
    }
  }
  const batchResults =
    requests.length > 0 ? await getCurrencyRates(requests) : []
  const rateByKey = new Map<string, CurrencyRate>()
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]!
    const result = batchResults[index]
    if (result?.ok) {
      rateByKey.set(
        `${request.date}|${request.base}|${request.target}`,
        result.rate,
      )
    }
  }

  return rows.map((row) => {
    const inputCurrency = (
      row.entry.currencyCode?.trim() || profileCurrency
    ).toUpperCase()
    const target = profileCurrency.toUpperCase()
    if (inputCurrency === target) {
      return {
        ledgerAmountMinor: row.entry.amount,
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
      }
    }
    if (
      !(supportedCurrencyCodes as readonly string[]).includes(inputCurrency) ||
      !(supportedCurrencyCodes as readonly string[]).includes(target)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${row.rowNumber}: unsupported currency ${inputCurrency} for conversion to ${target}`,
        cause: {
          code: 'PERSONAL_IMPORT_UNSUPPORTED_CURRENCY',
          params: { rowNumber: row.rowNumber },
        },
      })
    }
    const lookupDate = exchangeRateLookupDate(row.entry.date)
    const rate = rateByKey.get(`${lookupDate}|${inputCurrency}|${target}`)
    if (!rate) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Exchange rate unavailable for ${inputCurrency}→${target} on ${lookupDate} (row ${row.rowNumber}). Nothing was imported; remove the row or retry later.`,
        cause: {
          code: 'PERSONAL_IMPORT_FX_RATE_UNAVAILABLE',
          params: { rowNumber: row.rowNumber },
        },
      })
    }
    return {
      ledgerAmountMinor: convertMinorUnitsByRate(
        row.entry.amount,
        rate.rate,
        inputCurrency,
        target,
      ),
      originalAmount: row.entry.amount,
      originalCurrency: inputCurrency,
      conversionRate: rate.rate,
      conversionSource: 'EXCHANGE' as const,
    }
  })
}

function validateRowEntry(row: PersonalFileImportRow): void {
  if (!Number.isInteger(row.entry.amount) || row.entry.amount <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Row ${row.rowNumber}: amount must be a positive integer`,
      cause: {
        code: 'PERSONAL_IMPORT_INVALID_AMOUNT',
        params: { rowNumber: row.rowNumber },
      },
    })
  }
  if (row.entry.categoryId === 'settlement') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Row ${row.rowNumber}: settlements cannot be imported`,
      cause: {
        code: 'PERSONAL_IMPORT_SETTLEMENT',
        params: { rowNumber: row.rowNumber },
      },
    })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.entry.date)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Row ${row.rowNumber}: invalid date`,
      cause: {
        code: 'PERSONAL_IMPORT_INVALID_DATE',
        params: { rowNumber: row.rowNumber },
      },
    })
  }
}

export type PreparedPersonalFileImport = {
  profileCurrency: string
  conversions: ResolvedRowConversion[]
}

/**
 * External work (profile read, validation, FX quotes) runs before the
 * interactive transaction. The import transaction only holds the profile lock
 * while it re-checks the currency, scans duplicates, and writes.
 */
export async function preparePersonalFileImport(
  accountId: string,
  rows: PersonalFileImportRow[],
): Promise<PreparedPersonalFileImport> {
  if (rows.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select at least one row',
      cause: { code: 'PERSONAL_IMPORT_NO_ROWS', params: {} },
    })
  }
  for (const row of rows) validateRowEntry(row)
  const profile = await ensurePersonalProfile(accountId)
  return {
    profileCurrency: profile.currencyCode,
    conversions: await resolvePersonalConversions(profile.currencyCode, rows),
  }
}

export async function importPersonalFile(
  args: { accountId: string; rows: PersonalFileImportRow[] },
  options: {
    tx?: Prisma.TransactionClient
    prepared?: PreparedPersonalFileImport
  } = {},
) {
  if (args.rows.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select at least one row',
      cause: { code: 'PERSONAL_IMPORT_NO_ROWS', params: {} },
    })
  }

  const prepared =
    options.prepared ??
    (await preparePersonalFileImport(args.accountId, args.rows))

  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "accountId" FROM "PersonalProfile" WHERE "accountId" = ${args.accountId} FOR UPDATE`
    const profile = await ensurePersonalProfile(args.accountId, tx)
    const profileCurrency = profile.currencyCode
    if (profileCurrency !== prepared.profileCurrency) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The personal currency changed during the import. Try again.',
        cause: { code: 'PERSONAL_IMPORT_CURRENCY_CHANGED', params: {} },
      })
    }

    const conversions = prepared.conversions

    const { rows: duplicateRows } = await findPersonalFileImportDuplicates(
      args.accountId,
      profileCurrency,
      args.rows,
      tx,
    )
    const rowsById = new Map(args.rows.map((row) => [row.rowId, row]))
    const conflicts = duplicateRows.flatMap((result) => {
      const row = rowsById.get(result.rowId)
      const approved = new Set(row?.approvedDuplicateKeys ?? [])
      const unapproved = result.matches
        .map(({ key }) => key)
        .filter((key) => !approved.has(key))
      return unapproved.length === 0
        ? []
        : [
            {
              rowId: result.rowId,
              rowNumber: result.rowNumber,
              matchKeys: unapproved,
            },
          ]
    })
    if (conflicts.length > 0) {
      throw new PersonalFileImportDuplicateError(conflicts)
    }

    const transactionRows: Prisma.PersonalTransactionCreateManyInput[] = []
    const sourceRows: Prisma.PersonalFileImportSourceCreateManyInput[] = []
    const expenseIds: string[] = []
    for (let index = 0; index < args.rows.length; index += 1) {
      const row = args.rows[index]!
      const conversion = conversions[index]!
      const id = randomId()
      expenseIds.push(id)
      const kind = row.entry.kind
      const categoryId =
        kind === 'INCOME'
          ? row.entry.categoryId === 'general'
            ? 'income'
            : row.entry.categoryId
          : row.entry.categoryId === 'income'
            ? 'general'
            : row.entry.categoryId
      transactionRows.push({
        id,
        accountId: args.accountId,
        kind,
        amount: conversion.ledgerAmountMinor,
        currencyCode: profileCurrency,
        originalAmount: conversion.originalAmount,
        originalCurrency: conversion.originalCurrency,
        conversionRate: conversion.conversionRate,
        conversionSource: conversion.conversionSource,
        date: parseIsoDate(row.entry.date),
        categoryId,
        title: row.entry.title?.trim() ? row.entry.title.trim() : null,
        note: row.entry.note?.trim() ? row.entry.note.trim() : null,
        source: 'PERSONAL',
      })
      sourceRows.push({
        personalTransactionId: id,
        accountId: args.accountId,
        provider: PERSONAL_FILE_IMPORT_PROVIDER,
        importKey: storedPersonalImportKey(
          args.accountId,
          row.source.originFingerprint,
        ),
        externalIdentityHash: externalIdentityHash(
          row.externalId,
          row.sourceAccount,
        ),
        semanticHash: row.source.baseFingerprint,
        rawHash: row.source.originFingerprint,
        meta: {
          rowNumber: row.rowNumber,
          kind,
          fileCurrency: row.entry.currencyCode?.trim() || profileCurrency,
        },
        importedByAccountId: args.accountId,
      })
    }

    await createManyInBatches(transactionRows, (data) =>
      tx.personalTransaction.createMany({ data }),
    )
    await createManyInBatches(sourceRows, (data) =>
      tx.personalFileImportSource.createMany({ data }),
    )
    return { importedCount: expenseIds.length, transactionIds: expenseIds }
  }

  if (options.tx) return run(options.tx)
  return prisma.$transaction(run, { timeout: 120_000, maxWait: 30_000 })
}
