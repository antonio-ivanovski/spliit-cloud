import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  DELIMITED_MAPPING_KIND,
  DELIMITED_MAPPING_VERSION,
  MAX_DELIMITED_COLUMNS,
  MAX_DELIMITED_ROWS,
  MAX_REGEX_EXTRACT_INPUT_CHARS,
  analyzeDelimitedDateOrder,
  classifyDelimitedFieldMapping,
  classifyDelimitedMoneyMapping,
  compileDelimitedMapping,
  decodeDelimitedBytes,
  delimitedColumnSignature,
  evaluateDelimitedMapping,
  importCategorySourceKey,
  mapDelimitedRows,
  previewDelimitedRows,
  evaluateDelimitedMoneyMapping,
  parseDelimitedMappingJson,
  parseDelimitedNumber,
  parseDelimitedText,
  portableDelimitedMapping,
  resolvedAutoDateFormatLabel,
  simplifyDelimitedFieldMapping,
  simplifyDelimitedMoneyMapping,
  validateDelimitedMapping,
  validateDelimitedMoneyMapping,
  type DelimitedExpenseMappingV1,
  type DelimitedFieldMapping,
  type DelimitedTable,
  type DelimitedVisualMapping,
} from './generic-csv'
import { inferDelimitedExpenseMapping } from './inference'
import {
  inspectDelimitedCurrency,
  isDelimitedMoneyInput,
} from './money-detection'

const SAMPLE = `Date,Account,Category,Subcategory,Note,INR,Income/Expense,Note,Amount,Currency,Account
3/2/2022 10:11,CUB - online payment,Food,,Brownie,50,Expense,,50,INR,50
3/2/2022 10:11,CUB - online payment,Other,,To lended people,300,Expense,,300,INR,300
3/1/2022 19:50,CUB - online payment,Food,,Dinner,78,Expense,,78,INR,78
3/1/2022 18:56,CUB - online payment,Transportation,,Metro,30,Expense,,30,INR,30`

function* parseSample() {
  return yield* parseDelimitedText(SAMPLE)
}

function sampleMapping(table: DelimitedTable): DelimitedExpenseMappingV1 {
  return {
    kind: DELIMITED_MAPPING_KIND,
    version: DELIMITED_MAPPING_VERSION,
    name: 'Sample bank export',
    parsing: {
      delimiter: ',',
      headerRow: 0,
      encoding: 'UTF-8',
      columnSignature: delimitedColumnSignature(table),
    },
    mappings: {
      dateTime: {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'date#1', fallbacks: [] }],
        transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
      },
      title: {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'note#1', fallbacks: ['account#1'] }],
        transforms: [{ kind: 'TRIM' }],
      },
      money: {
        mode: 'VISUAL',
        amount: {
          mode: 'VISUAL',
          sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
          transforms: [
            { kind: 'PARSE_NUMBER', format: 'AUTO' },
            {
              kind: 'SIGN_FROM_COLUMN',
              columnKey: 'income_expense#1',
              negativeValues: ['Income'],
            },
          ],
        },
        currency: {
          mode: 'VISUAL',
          sourceValues: [{ primary: 'currency#1', fallbacks: [] }],
          transforms: [{ kind: 'UPPER' }],
        },
      },
      categorySource: {
        mode: 'VISUAL',
        sourceValues: [
          { primary: 'category#1', fallbacks: [] },
          { primary: 'subcategory#1', fallbacks: [] },
        ],
        transforms: [{ kind: 'JOIN', separator: ' / ' }, { kind: 'TRIM' }],
      },
      notes: {
        mode: 'CEL',
        expression: 'clean(row["account#1"])',
      },
    },
    categoryBindings: {
      food: 'food-and-drink',
      transportation: 'transportation',
    },
    defaults: { currencyCode: 'INR', categoryId: 'general' },
    groupBindings: {
      payerName: 'Antonio',
      splitMode: 'EVENLY',
      paidFor: [
        { participantName: 'Antonio', shares: 1 },
        { participantName: 'Alex', shares: 1 },
      ],
    },
  }
}

describe('delimited expense importer', () => {
  it.effect(
    'rejects oversized row and column shapes before normalizing the table',
    () =>
      Effect.gen(function* () {
        const tooManyRows = [
          'Date,Title,Amount',
          ...Array.from(
            { length: MAX_DELIMITED_ROWS + 1 },
            () => '3/2/2022,Meal,10',
          ),
        ].join('\n')
        {
          const rowsError = yield* Effect.flip(parseDelimitedText(tooManyRows))
          expect(rowsError.message).toBe(
            'The file cannot contain more than 10,000 rows',
          )
          expect(rowsError.code).toBe('DELIMITED_TOO_MANY_ROWS')
          expect(rowsError.params).toEqual({ max: '10,000' })
        }

        const tooManyColumns = [
          Array.from(
            { length: MAX_DELIMITED_COLUMNS + 1 },
            (_, index) => `Column ${index + 1}`,
          ).join(','),
          Array.from({ length: MAX_DELIMITED_COLUMNS + 1 }, () => 'value').join(
            ',',
          ),
        ].join('\n')
        {
          const columnsError = yield* Effect.flip(
            parseDelimitedText(tooManyColumns),
          )
          expect(columnsError.message).toBe(
            'The file cannot contain more than 500 columns',
          )
          expect(columnsError.code).toBe('DELIMITED_TOO_MANY_COLUMNS')
          expect(columnsError.params).toEqual({ max: '500' })
        }
      }),
  )

  it.effect(
    'returns concrete parsing settings when delimiter detection is automatic',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          `Date;Title;Amount\n3/2/2022;Meal;10`,
        )
        expect(table).toMatchObject({
          delimiter: ';',
          encoding: 'UTF-8',
        })
        const internalAutoTable = yield* parseDelimitedText(
          `Date\tTitle\tAmount\n3/2/2022\tMeal\t10`,
          { delimiter: 'AUTO' },
        )
        expect(internalAutoTable).toMatchObject({
          delimiter: '	',
        })
      }),
  )

  it.effect('sniffs UTF-16 byte order marks instead of decoding mojibake', () =>
    Effect.gen(function* () {
      // Index-based access yields UTF-16 code units (what the BOM cases below
      // need); spreading would iterate code points and split surrogates.
      const sample = 'Date,Title,Amount\n2022-03-14,Caf\u00e9,10'
      const units = Array.from({ length: sample.length }, (_, index) =>
        sample.charCodeAt(index),
      )
      const cases = [
        [0xff, 0xfe, units.flatMap((code) => [code & 0xff, code >> 8])],
        [0xfe, 0xff, units.flatMap((code) => [code >> 8, code & 0xff])],
      ] as const
      for (const [bom0, bom1, body] of cases) {
        const raw = new Uint8Array([bom0, bom1, ...body])
        const decoded = decodeDelimitedBytes(raw.buffer as ArrayBuffer)
        expect(decoded.encoding).toBe('UTF-16')
        const table = yield* parseDelimitedText(decoded.text)
        expect(table).toMatchObject({
          delimiter: ',',
        })
        expect(table.rows[0]?.cells[1]).toBe('Caf\u00e9')
      }
    }),
  )

  it.effect(
    'parses supported ISO timestamps strictly and rejects invalid dates',
    () =>
      Effect.gen(function* () {
        const isoTable = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-02T10:11:00.000Z,Meal,10',
        )
        const rows = yield* previewDelimitedRows(
          isoTable,
          sampleMapping(isoTable),
        )
        expect(rows[0]).toMatchObject({ expenseDate: '2022-03-02' })

        const invalidTable = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-99-99T10:11:00Z,Meal,10',
        )
        const invalidRows = yield* previewDelimitedRows(
          invalidTable,
          sampleMapping(invalidTable),
        )
        expect(invalidRows[0]?.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'INVALID_DATE',
              field: 'dateTime',
            }),
          ]),
        )
      }),
  )

  it.effect(
    'accepts explicit custom formats with a trailing timezone token',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-02T10:11:00Z,Meal,10',
        )
        const mapping = {
          ...sampleMapping(table),
          mappings: {
            ...sampleMapping(table).mappings,
            dateTime: {
              mode: 'VISUAL' as const,
              sourceValues: [{ primary: 'date#1', fallbacks: [] as string[] }],
              transforms: [
                { kind: 'PARSE_DATE', format: 'YYYY-MM-DDTHH:mm:ssZ' } as const,
              ],
            },
          },
        }
        // Offsets preserve the instant: the wall time is the instant rendered in
        // UTC, not the raw wall clock from the file (nor the runtime local zone).
        const instant = new Date('2022-03-02T10:11:00Z')
        const pad = (value: number) => String(value).padStart(2, '0')
        const expectedDate = `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`
        expect((yield* previewDelimitedRows(table, mapping))[0]).toMatchObject({
          expenseDate: expectedDate,
          expenseTimeMinutes:
            instant.getUTCHours() * 60 + instant.getUTCMinutes(),
        })
      }),
  )

  it('composes ordered source values with a required Join transformation', () => {
    const mapping = {
      mode: 'VISUAL' as const,
      sourceValues: [
        { primary: 'account#1', fallbacks: [] },
        { primary: 'note#1', fallbacks: ['description#1'] },
      ],
      transforms: [
        { kind: 'JOIN' as const, separator: ' · ' },
        { kind: 'TRIM' as const },
      ],
    }
    expect(compileDelimitedMapping(mapping)).toContain('joinNonEmpty')
    expect(() =>
      compileDelimitedMapping({
        ...mapping,
        transforms: [{ kind: 'TRIM' as const }],
      }),
    ).toThrow('Join transformation')
  })

  it('classifies visual mappings and preserves essentials when simplifying', () => {
    const advanced: DelimitedVisualMapping = {
      mode: 'VISUAL' as const,
      sourceValues: [
        { primary: 'note#1', fallbacks: ['account#1'] },
        { primary: 'category#1', fallbacks: [] },
      ],
      transforms: [
        { kind: 'JOIN' as const, separator: ' · ' },
        { kind: 'TRIM' as const },
        { kind: 'UPPER' as const },
        { kind: 'PARSE_NUMBER' as const, format: 'COMMA' },
      ],
    }
    expect(classifyDelimitedFieldMapping(advanced, 'text')).toBe('ADVANCED')
    const simple = simplifyDelimitedFieldMapping(advanced, 'text')
    expect(simple).toEqual({
      mode: 'VISUAL',
      sourceValues: [{ primary: 'note#1', fallbacks: [] }],
      transforms: [{ kind: 'TRIM' }],
    })

    const money = {
      mode: 'VISUAL' as const,
      amount: advanced,
      currency: {
        mode: 'VISUAL' as const,
        sourceValues: [{ primary: 'currency#1', fallbacks: [] }],
        transforms: [{ kind: 'EXTRACT_CURRENCY' as const }],
      },
    }
    expect(classifyDelimitedMoneyMapping(money)).toBe('ADVANCED')
    expect(simplifyDelimitedMoneyMapping(money)).toMatchObject({
      amount: {
        sourceValues: [{ primary: 'note#1', fallbacks: [] }],
        transforms: [
          { kind: 'TRIM' },
          { kind: 'PARSE_NUMBER', format: 'COMMA' },
        ],
      },
      currency: {
        sourceValues: [{ primary: 'currency#1', fallbacks: [] }],
      },
    })
  })

  it.effect(
    'infers date order from decisive rows and blocks contradictory columns',
    () =>
      Effect.gen(function* () {
        const dmyTable = yield* parseDelimitedText(
          `Date,Title,Amount\n23/2/2022,Meal,10\n3/2/2022,Snack,5`,
        )
        const mapping = {
          ...sampleMapping(dmyTable),
          mappings: {
            ...sampleMapping(dmyTable).mappings,
            dateTime: {
              mode: 'VISUAL' as const,
              sourceValues: [{ primary: 'date#1', fallbacks: [] as string[] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' } as const],
            },
          },
        }
        expect(
          analyzeDelimitedDateOrder(dmyTable, mapping.mappings.dateTime),
        ).toMatchObject({
          status: 'DECISIVE',
          order: 'DMY',
        })

        const mixedTable = yield* parseDelimitedText(
          `Date,Title,Amount\n23/2/2022,Meal,10\n2/23/2022,Snack,5`,
        )
        expect(
          analyzeDelimitedDateOrder(mixedTable, mapping.mappings.dateTime)
            .status,
        ).toBe('MIXED')

        const isoTable = yield* parseDelimitedText(
          `Date,Title,Amount\n2022-03-02,Meal,10\n2022-03-03,Snack,5`,
        )
        expect(
          analyzeDelimitedDateOrder(isoTable, mapping.mappings.dateTime).status,
        ).toBe('EXPLICIT')
      }),
  )

  it.effect('evaluates a typed money mapping from separate lanes', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const mapping = sampleMapping(table).mappings.money
      expect(
        evaluateDelimitedMoneyMapping(mapping, {
          'amount#1': '12.50',
          'currency#1': 'EUR',
          'income_expense#1': 'Expense',
        }),
      ).toEqual({ amount: 12.5, currency: 'EUR' })
      expect(
        evaluateDelimitedMoneyMapping(
          { mode: 'CEL', expression: '{"amount": 12.5, "currency": "EUR"}' },
          {},
        ),
      ).toEqual({ amount: 12.5, currency: 'EUR' })
      expect(
        evaluateDelimitedMoneyMapping(
          {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
            currency: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'EXTRACT_CURRENCY' }],
            },
          },
          { 'amount#1': '12.50 EUR' },
        ),
      ).toEqual({ amount: 12.5, currency: 'EUR' })
    }),
  )

  it.effect('parses duplicate headers and transforms the supplied sample', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      expect(table.columns.map((column) => column.label)).toContain('Note (2)')
      expect(table.columns.map((column) => column.label)).toContain(
        'Account (2)',
      )

      const rows = yield* mapDelimitedRows(table, sampleMapping(table))
      expect(rows[0]).toMatchObject({
        title: 'Brownie',
        expenseDate: '2022-03-02',
        expenseTimeMinutes: 10 * 60 + 11,
        amount: 5000,
        currency: 'INR',
        category: 'food-and-drink',
        notes: 'CUB - online payment',
        error: null,
        warning: null,
      })
      expect(rows[1]).toMatchObject({
        title: 'To lended people',
        category: 'general',
        warning: 'Category “Other” will use General',
      })
    }),
  )

  it.effect('uses conditional sign rules to create income', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      table.rows[0]!.cells[6] = 'Income'
      const rows = yield* mapDelimitedRows(table, sampleMapping(table))
      expect(rows[0]).toMatchObject({ amount: -5000, category: 'income' })
    }),
  )

  it.effect('reports field-specific preview issues before final mapping', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      table.rows[1]!.cells[4] = ''
      table.rows[1]!.cells[1] = ''
      table.rows[2]!.cells[8] = 'not-a-number'
      const rows = yield* previewDelimitedRows(table, sampleMapping(table), {
        includeAmbiguousDateIssue: true,
      })
      expect(rows[0]!.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 2,
            field: 'dateTime',
            code: 'AMBIGUOUS_DATE',
            severity: 'warning',
          }),
        ]),
      )
      expect(rows[1]!.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 3,
            field: 'title',
            code: 'MISSING_TITLE',
          }),
        ]),
      )
      expect(rows[2]!.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 4,
            field: 'amount',
            code: 'INVALID_AMOUNT',
          }),
        ]),
      )
    }),
  )

  it('supports locale-aware numbers and safe CEL expressions', () => {
    expect(parseDelimitedNumber('1.234,56', 'COMMA')).toBe(1234.56)
    expect(parseDelimitedNumber('(1,234.56)', 'DOT')).toBe(-1234.56)
    expect(
      compileDelimitedMapping({
        mode: 'CEL',
        expression: 'firstNonEmpty([row["note#1"], row["account#1"]])',
      }),
    ).toContain('firstNonEmpty')
  })

  it('normalizes non-ASCII minus signs instead of flipping the sign', () => {
    // U+2212 minus and en/em dashes must parse negative: stripping them
    // would silently import −50 as +50 (income becoming an expense).
    expect(parseDelimitedNumber('−50', 'AUTO')).toBe(-50)
    expect(parseDelimitedNumber('–50', 'AUTO')).toBe(-50)
    expect(parseDelimitedNumber('—50.25', 'AUTO')).toBe(-50.25)
    expect(isDelimitedMoneyInput('−50')).toBe(true)
  })

  it('applies trailing CR/DR markers instead of importing them positive', () => {
    expect(parseDelimitedNumber('100CR', 'AUTO')).toBe(-100)
    expect(parseDelimitedNumber('100 DR', 'AUTO')).toBe(100)
    expect(parseDelimitedNumber('(100)DR', 'AUTO')).toBe(100)
    // Bare C/D and currency codes are not markers.
    expect(parseDelimitedNumber('100 CAD', 'AUTO')).toBe(100)
    expect(parseDelimitedNumber('100 C', 'AUTO')).toBe(100)
  })

  it.effect('parses two-digit years with times like date-only values', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n01/02/24 10:11,Meal,10',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'DMY')
      // Force the ambiguous file onto the DMY reading end to end: 1 Feb 2024
      // at 10:11, not an INVALID_DATE.
      const rows = yield* mapDelimitedRows(table, mapping, undefined, {
        preferredDateOrder: 'DMY',
      })
      expect(rows.map((row) => row.expenseDate)).toEqual(['2024-02-01'])
      expect(rows[0]?.expenseTimeMinutes).toBe(10 * 60 + 11)
    }),
  )

  it.effect('parses English month names end to end', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n14-Mar-2022,Meal,10\n"MAR 4, 2022",Snack,20',
      )
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
      const rows = yield* mapDelimitedRows(table, mapping)
      expect(rows.map((row) => row.expenseDate)).toEqual([
        '2022-03-14',
        '2022-03-04',
      ])
      expect(rows.every((row) => row.error === null)).toBe(true)
    }),
  )

  it.effect('reports actionable errors for unmapped required columns', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText('Amount,Title\n50,Meal')
      const { mapping } = inferDelimitedExpenseMapping(table, 'USD', 'MDY')
      // No date column: the placeholder must never leak into user errors.
      const rows = yield* mapDelimitedRows(table, mapping)
      const codes = rows[0]!.issues.map((issue) => issue.code)
      expect(codes).toContain('DATE_SOURCE_UNMAPPED')
      expect(
        rows[0]!.issues.find((issue) => issue.code === 'DATE_SOURCE_UNMAPPED')
          ?.message,
      ).toContain('choose a source column')
      expect(
        rows
          .flatMap((row) =>
            row.issues.map((issue) => issue.message + issue.code),
          )
          .join('\n'),
      ).not.toContain('__unmapped__')
    }),
  )

  it.effect(
    'preserves an explicit CEL midnight instead of noon-anchoring it',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-14,Meal,10',
        )
        const baseMapping = sampleMapping(table)
        const mapping = {
          ...baseMapping,
          mappings: {
            ...baseMapping.mappings,
            dateTime: {
              mode: 'CEL' as const,
              expression: 'parseDate(row["date#1"], "YYYY-MM-DD")',
            },
          },
        }
        const rows = yield* mapDelimitedRows(table, mapping)
        expect(rows[0]?.expenseDate).toBe('2022-03-14')
        expect(rows[0]?.expenseTimeMinutes).toBe(0)
      }),
  )

  it.effect(
    'keeps date-only values with a vestigial Z on the same calendar day',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-14Z,Meal,10',
        )
        const mapping = sampleMapping(table)
        const rows = yield* mapDelimitedRows(table, mapping)
        // The instant path would render in the runtime zone (previous day in
        // negative-offset zones); date-only values stay noon-anchored instead.
        expect(rows[0]?.expenseDate).toBe('2022-03-14')
        expect(rows[0]?.expenseTimeMinutes).toBe(12 * 60)
      }),
  )

  it.effect('reports a friendly mapping failure without the engine frame', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const baseMapping = sampleMapping(table)
      const title = baseMapping.mappings.title
      expect(title.mode).toBe('VISUAL')
      if (title.mode !== 'VISUAL') throw new Error('expected visual title')
      const mapping = {
        ...baseMapping,
        mappings: {
          ...baseMapping.mappings,
          title: {
            ...title,
            transforms: [
              ...(title.transforms ?? []),
              {
                kind: 'REGEX_EXTRACT',
                pattern: '([',
                group: 0,
              } as const,
            ],
          },
        },
      }
      const rows = yield* mapDelimitedRows(table, mapping)
      const failure = rows[0]!.issues.find(
        (issue) => issue.code === 'MAPPING_FAILED',
      )
      expect(failure?.message).toContain('Mapping failed')
      expect(failure?.message).toContain('note#1')
      expect(failure?.message).not.toContain('REGEX_EXTRACT')
      expect(failure?.message).not.toContain('No such key')
    }),
  )

  it.effect('hides the CEL engine frame for missing keys', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n2022-03-14,Meal,10',
      )
      const baseTitleMapping = sampleMapping(table)
      const mapping = {
        ...baseTitleMapping,
        mappings: {
          ...baseTitleMapping.mappings,
          title: {
            mode: 'CEL' as const,
            expression: 'row["missing#1"]',
          },
        },
      }
      const rows = yield* mapDelimitedRows(table, mapping)
      const failure = rows[0]!.issues.find(
        (issue) => issue.code === 'MAPPING_FAILED',
      )
      expect(failure?.message).toContain('Mapping failed')
      expect(failure?.message).toContain('missing#1')
      expect(failure?.message).not.toContain('No such key')
      expect(failure?.message).not.toMatch(/>\d+\|/)
    }),
  )

  it('marks conflicting currency symbols ambiguous instead of picking one', () => {
    expect(inspectDelimitedCurrency('€ £50')).toMatchObject({
      ambiguous: true,
    })
    expect(inspectDelimitedCurrency('€50')).toMatchObject({
      code: 'EUR',
      ambiguous: false,
    })
  })

  it.effect('suppresses the sign warning for recognized positive values', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Credit,Type\n2022-03-14,Meal,50,Expense',
      )
      const build = (positiveValues?: string[]) => {
        const base = sampleMapping(table)
        return {
          ...base,
          mappings: {
            ...base.mappings,
            money: {
              mode: 'VISUAL' as const,
              amount: {
                mode: 'VISUAL' as const,
                sourceValues: [
                  { primary: 'credit#1', fallbacks: [] as string[] },
                ],
                transforms: [
                  { kind: 'TRIM' } as const,
                  { kind: 'PARSE_NUMBER', format: 'AUTO' } as const,
                  {
                    kind: 'SIGN_FROM_COLUMN',
                    columnKey: 'type#1',
                    negativeValues: ['income'],
                    ...(positiveValues ? { positiveValues } : {}),
                  } as const,
                ],
              },
            },
          },
        }
      }
      // `Expense` is a known positive: absolute() is intended, no warning.
      const quiet = yield* mapDelimitedRows(
        table,
        build(['expense', 'debit', 'withdrawal']),
      )
      expect(quiet[0]).toMatchObject({ amount: 5000 })
      expect(
        quiet[0]!.issues.some((issue) => issue.code === 'SIGN_COLUMN_IGNORED'),
      ).toBe(false)
      // Legacy mappings without positiveValues keep warning on truly negative
      // lane values, but a positive lane value never warns (nothing was
      // ignored: the magnitude was already positive).
      const legacy = yield* mapDelimitedRows(table, build())
      expect(legacy[0]).toMatchObject({ amount: 5000 })
      expect(
        legacy[0]!.issues.some((issue) => issue.code === 'SIGN_COLUMN_IGNORED'),
      ).toBe(false)
    }),
  )

  it('decodes explicitly requested UTF-16BE without a BOM', () => {
    const text = 'Date,Title,Amount\n2022-03-14,Meal,10\n'
    const bytes = Buffer.from(text, 'utf16le')
    // Manually byte-swap to big-endian without adding a BOM.
    const swapped = Buffer.alloc(bytes.length)
    for (let index = 0; index < bytes.length; index += 2) {
      swapped[index] = bytes[index + 1]!
      swapped[index + 1] = bytes[index]!
    }
    const decoded = decodeDelimitedBytes(
      swapped.buffer.slice(
        swapped.byteOffset,
        swapped.byteOffset + swapped.byteLength,
      ),
      'UTF-16',
    )
    expect(decoded.text).toBe(text)
  })

  it.effect('includes the received title in MISSING_TITLE errors', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n2022-03-14,X,10',
      )
      const mapping = sampleMapping(table)
      // sampleMapping targets the shared SAMPLE fixture; repoint the title at
      // this table's column so the single-char value (not a missing key) is
      // what fails.
      const title = mapping.mappings.title
      expect(title.mode).toBe('VISUAL')
      if (title.mode !== 'VISUAL') throw new Error('expected visual title')
      const mappingWithTitle = {
        ...mapping,
        mappings: {
          ...mapping.mappings,
          title: {
            ...title,
            sourceValues: [{ primary: 'title#1', fallbacks: [] as string[] }],
          },
        },
      }
      const rows = yield* mapDelimitedRows(table, mappingWithTitle)
      expect(
        rows[0]!.issues.find((issue) => issue.code === 'MISSING_TITLE')
          ?.message,
      ).toContain('X')
    }),
  )

  it.effect('round-trips portable JSON without group bindings', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const portable = yield* portableDelimitedMapping(sampleMapping(table))
      expect(portable.groupBindings).toBeUndefined()
      expect(
        yield* parseDelimitedMappingJson(JSON.stringify(portable)),
      ).toEqual(portable)
    }),
  )

  it.effect(
    'builds stable origin fingerprints without retaining row content',
    () =>
      Effect.gen(function* () {
        const table = yield* parseSample()
        const mapping = sampleMapping(table)
        const first = yield* mapDelimitedRows(table, mapping)
        const second = yield* mapDelimitedRows(table, mapping)
        expect(first.map((row) => row.source)).toEqual(
          second.map((row) => row.source),
        )
        expect(JSON.stringify(first[0]!.source)).not.toContain('Brownie')

        const duplicateTable = yield* parseSample()
        duplicateTable.rows.push({
          rowNumber: 6,
          cells: [...duplicateTable.rows[0]!.cells],
        })
        const duplicates = yield* mapDelimitedRows(
          duplicateTable,
          sampleMapping(duplicateTable),
        )
        expect(duplicates[0]!.source.baseFingerprint).toBe(
          duplicates[4]!.source.baseFingerprint,
        )
        expect(duplicates[0]!.source.originFingerprint).not.toBe(
          duplicates[4]!.source.originFingerprint,
        )
      }),
  )

  it.effect(
    'keeps colliding headers on unique keys with their own values',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Amount $,Amount!\n2022-03-14,10,20\n2022-03-15,30,40',
        )
        expect(table.columns.map((column) => column.key)).toEqual([
          'date#1',
          'amount#1',
          'amount#2',
        ])
        expect(
          (yield* previewDelimitedRows(table, {
            ...sampleMapping(table),
            mappings: {
              ...sampleMapping(table).mappings,
              dateTime: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'date#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
              },
              title: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'date#1', fallbacks: [] }],
                transforms: [{ kind: 'TRIM' }],
              },
              money: {
                mode: 'VISUAL',
                amount: {
                  mode: 'VISUAL',
                  sourceValues: [{ primary: 'amount#2', fallbacks: [] }],
                  transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
                },
              },
            },
          })).map((row) => row.amount),
        ).toEqual([2000, 4000])
      }),
  )

  it.effect(
    'detects the delimiter below preamble rows when a header row is given',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Monthly statement\nGenerated yesterday\nDate;Title;Amount\n3/2/2022;Meal;10',
          { headerRow: 2 },
        )
        expect(table).toMatchObject({
          delimiter: ';',
        })
        expect(table.columns.map((column) => column.sourceLabel)).toEqual([
          'Date',
          'Title',
          'Amount',
        ])
      }),
  )

  it.effect('parses dot-separated and two-digit-year dates', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n31.12.2024,Edeka,12\n01/02/24,Meal,10',
      )
      const mapping: DelimitedExpenseMappingV1 = {
        ...sampleMapping(table),
        mappings: {
          ...sampleMapping(table).mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_DMY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      }
      const rows = yield* previewDelimitedRows(table, mapping)
      expect(rows.map((row) => row.expenseDate)).toEqual([
        '2024-12-31',
        '2024-02-01',
      ])
      expect(
        rows.every(
          ({ issues }) =>
            !issues.some(
              (issue) =>
                issue.field === 'dateTime' && issue.severity === 'error',
            ),
        ),
      ).toBe(true)
    }),
  )

  it.effect(
    'falls back to the group currency for unverified currency words',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount,Currency\n2022-03-14,Meal,10,Bought ABC apples',
        )
        const base = sampleMapping(table)
        const rows = yield* previewDelimitedRows(table, {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
              currency: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'currency#1', fallbacks: [] }],
                transforms: [{ kind: 'EXTRACT_CURRENCY' }],
              },
            },
          },
          defaults: { currencyCode: 'USD', categoryId: 'general' },
        })
        expect(rows[0]?.currency).toBe('USD')
        expect(
          rows[0]?.issues.some(
            (issue) => issue.code === 'UNSUPPORTED_CURRENCY',
          ),
        ).toBe(false)
      }),
  )

  it('keeps paired debit/credit mappings intact when simplifying', () => {
    const mapping: DelimitedExpenseMappingV1['mappings']['money'] = {
      mode: 'VISUAL',
      amount: {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'debit#1', fallbacks: [] }],
        transforms: [
          {
            kind: 'DEBIT_CREDIT',
            debitColumn: 'debit#1',
            creditColumn: 'credit#1',
            format: 'AUTO',
          },
        ],
      },
    }
    expect(simplifyDelimitedMoneyMapping(mapping)).toBe(mapping)
  })

  it.effect('flags ambiguous rows in mixed-order files', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n13/01/2024,Decisive DMY,10\n01/13/2024,Decisive MDY,20\n05/06/2024,Ambiguous,30',
      )
      const base = sampleMapping(table)
      const mapping: DelimitedExpenseMappingV1 = {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      }
      const rows = yield* previewDelimitedRows(table, mapping)
      expect(
        rows[0]?.issues.some(
          (issue) => issue.code === 'INCONSISTENT_DATE_ORDER',
        ),
      ).toBe(true)
      expect(
        rows[1]?.issues.some(
          (issue) => issue.code === 'INCONSISTENT_DATE_ORDER',
        ),
      ).toBe(true)
      expect(
        rows[2]?.issues.some((issue) => issue.code === 'AMBIGUOUS_DATE'),
      ).toBe(true)
    }),
  )

  it.effect('rejects invalid transform combinations when validating', () =>
    Effect.gen(function* () {
      const paired: DelimitedVisualMapping = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'debit#1', fallbacks: [] }],
        transforms: [
          { kind: 'TRIM' },
          {
            kind: 'DEBIT_CREDIT',
            debitColumn: 'debit#1',
            creditColumn: 'credit#1',
            format: 'AUTO',
          },
        ],
      }
      {
        const error = yield* Effect.flip(validateDelimitedMapping(paired))
        expect(error.message).toContain('must be the only transformation')
      }
      const signWithoutNumber: DelimitedVisualMapping = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
        transforms: [
          {
            kind: 'SIGN_FROM_COLUMN',
            columnKey: 'type#1',
            negativeValues: ['income'],
          },
        ],
      }
      {
        const error = yield* Effect.flip(
          validateDelimitedMapping(signWithoutNumber),
        )
        expect(error.message).toContain('needs a parsed number')
      }
      const valid: DelimitedVisualMapping = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
        transforms: [
          { kind: 'PARSE_NUMBER', format: 'AUTO' },
          {
            kind: 'SIGN_FROM_COLUMN',
            columnKey: 'type#1',
            negativeValues: ['income'],
          },
        ],
      }
      expect(yield* validateDelimitedMapping(valid)).toEqual(valid)
      {
        const error = yield* Effect.flip(
          validateDelimitedMoneyMapping({
            mode: 'VISUAL',
            amount: paired,
          }),
        )
        expect(error.message).toContain('must be the only transformation')
      }
    }),
  )

  it.effect('includes the received value in unparseable-cell messages', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\nnot a date,Meal,10',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      })
      expect(
        rows[0]?.issues.find((issue) => issue.code === 'INVALID_DATE')?.message,
      ).toContain('not a date')
    }),
  )

  it.effect(
    'commits different dates for DMY vs MDY with the same ambiguous mapping',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n05/06/2024,Meal,10\n07/08/2024,Snack,20',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
            },
          },
        }
        const dmy = yield* mapDelimitedRows(table, mapping, undefined, {
          preferredDateOrder: 'DMY',
        })
        const mdy = yield* mapDelimitedRows(table, mapping, undefined, {
          preferredDateOrder: 'MDY',
        })
        expect(dmy.map((row) => row.expenseDate)).toEqual([
          '2024-06-05',
          '2024-08-07',
        ])
        expect(mdy.map((row) => row.expenseDate)).toEqual([
          '2024-05-06',
          '2024-07-08',
        ])
        const omitted = yield* mapDelimitedRows(table, mapping)
        expect(omitted.map((row) => row.expenseDate)).toEqual(
          mdy.map((row) => row.expenseDate),
        )
      }),
  )

  it.effect(
    'labels AUTO dates by the effective parse order, not the data votes',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n25/3/2022,Meal,10\n26/3/2022,Snack,20',
        )
        const dateMapping: DelimitedFieldMapping = {
          mode: 'VISUAL',
          sourceValues: [{ primary: 'date#1', fallbacks: [] }],
          transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
        }
        // Decisive day/month data under an AUTO_MDY mapping still parses as the
        // mapping default (votes never drive parsing), so the label must show the
        // mapping default — claiming day/month here would contradict preview/MAP.
        expect(
          resolvedAutoDateFormatLabel('AUTO_MDY', dateMapping, table),
        ).toContain('month/day')
        // Explicit formats pass through untouched.
        expect(
          resolvedAutoDateFormatLabel('YYYY-MM-DD', dateMapping, table),
        ).toBe('YYYY-MM-DD')

        const ambiguousTable = yield* parseDelimitedText(
          'Date,Title,Amount\n03/04/2022,Meal,10\n05/06/2022,Snack,20',
        )
        // Ambiguous data plus an explicit DMY preference rewrites AUTO at parse
        // time, so the label follows the preference…
        expect(
          resolvedAutoDateFormatLabel(
            'AUTO_MDY',
            dateMapping,
            ambiguousTable,
            'DMY',
          ),
        ).toContain('day/month')
        // …while without a preference the mapping default stands.
        expect(
          resolvedAutoDateFormatLabel('AUTO_MDY', dateMapping, ambiguousTable),
        ).toContain('month/day')
      }),
  )

  it('decodes no-BOM UTF-16LE/BE via NUL heuristic and leaves ASCII alone', () => {
    const text = 'Date,Title,Amount\n2022-03-14,Café,10'
    const encodeLE = (value: string) => {
      const out: number[] = []
      for (const char of value) {
        const code = char.charCodeAt(0)
        out.push(code & 0xff, code >> 8)
      }
      return new Uint8Array(out)
    }
    const encodeBE = (value: string) => {
      const out: number[] = []
      for (const char of value) {
        const code = char.charCodeAt(0)
        out.push(code >> 8, code & 0xff)
      }
      return new Uint8Array(out)
    }
    for (const bytes of [encodeLE(text), encodeBE(text)]) {
      const decoded = decodeDelimitedBytes(bytes.buffer as ArrayBuffer)
      expect(decoded.encoding).toBe('UTF-16')
      expect(decoded.text).toBe(text)
    }
    const ascii = new TextEncoder().encode(
      'Date,Title,Amount\n2022-03-14,Meal,10',
    )
    expect(decodeDelimitedBytes(ascii.buffer as ArrayBuffer).encoding).toBe(
      'UTF-8',
    )
  })

  it('decodes explicit WINDOWS-1252 bytes', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Date,Title,Amount\n2022-03-14,Caf'),
      0xe9,
      ...new TextEncoder().encode(',10'),
    ])
    const decoded = decodeDelimitedBytes(
      bytes.buffer as ArrayBuffer,
      'WINDOWS-1252',
    )
    expect(decoded.encoding).toBe('WINDOWS-1252')
    expect(decoded.text).toContain('Café')
  })

  it.effect(
    'warns when an unlisted sign-column value overrides an explicit negative',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Description,Amount,Type\n2022-03-14,Refund,-20,ACH',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'description#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [
                  { kind: 'PARSE_NUMBER', format: 'AUTO' },
                  {
                    kind: 'SIGN_FROM_COLUMN',
                    columnKey: 'type#1',
                    negativeValues: ['Income'],
                  },
                ],
              },
            },
          },
        }
        const rows = yield* previewDelimitedRows(table, mapping)
        const warning = rows[0]?.issues.find(
          (issue) => issue.code === 'SIGN_COLUMN_IGNORED',
        )
        expect(warning).toMatchObject({ field: 'amount', severity: 'warning' })
        expect(warning?.message).toContain('Type')
        expect(warning?.message).toContain('ACH')
        expect(rows[0]?.amount).toBe(2000)
      }),
  )

  it.effect('preserves the instant for explicit offsets', () =>
    Effect.gen(function* () {
      const original = '2024-01-02T01:00:00+02:00'
      const table = yield* parseDelimitedText(
        `Date,Title,Amount\n${original},Meal,10`,
      )
      const base = sampleMapping(table)
      const mapping: DelimitedExpenseMappingV1 = {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      }
      const row = (yield* previewDelimitedRows(table, mapping))[0]!
      const pad = (value: number) => String(value).padStart(2, '0')
      const wall = `${row.expenseDate}T${pad(Math.floor(row.expenseTimeMinutes / 60))}:${pad(row.expenseTimeMinutes % 60)}:00Z`
      expect(new Date(wall).getTime()).toBe(Date.parse(original))
    }),
  )

  it.effect('throws on stale column signatures for preview and map', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const mapping = sampleMapping(table)
      const staleTable: DelimitedTable = {
        ...table,
        columns: [
          ...table.columns,
          {
            index: table.columns.length,
            key: 'extra#1',
            label: 'Extra',
            sourceLabel: 'Extra',
            occurrence: 1,
          },
        ],
      }
      {
        const previewError = yield* Effect.flip(
          previewDelimitedRows(staleTable, mapping),
        )
        expect(previewError.message).toMatch(/columns changed since/i)
      }
      {
        const mapError = yield* Effect.flip(
          mapDelimitedRows(staleTable, mapping),
        )
        expect(mapError.message).toMatch(/columns changed since/i)
      }
    }),
  )

  it.effect(
    'detects currency codes adjacent to digits while ignoring plain words',
    () =>
      Effect.gen(function* () {
        expect(inspectDelimitedCurrency('50EUR').code).toBe('EUR')
        expect(inspectDelimitedCurrency('EUR50').code).toBe('EUR')
        expect(inspectDelimitedCurrency('THE').code).toBeNull()
        expect(isDelimitedMoneyInput('50EUR')).toBe(true)
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-14,Cafe,50EUR',
        )
        const base = sampleMapping(table)
        const rows = yield* previewDelimitedRows(table, {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
              currency: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'EXTRACT_CURRENCY' }],
              },
            },
          },
          defaults: { currencyCode: 'USD', categoryId: 'general' },
        })
        expect(rows[0]?.currency).toBe('EUR')
      }),
  )

  it.effect('parses AM/PM times in auto date formats', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n3/2/2022 10:11 PM,Meal,10',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      })
      expect(rows[0]).toMatchObject({
        expenseDate: '2022-03-02',
        expenseTimeMinutes: 22 * 60 + 11,
      })
    }),
  )

  it.effect('parses 12 AM/PM boundaries in auto date formats', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n3/2/2022 12:00 AM,Midnight meal,10\n3/2/2022 12:00 PM,Noon snack,20',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      })
      expect(rows[0]).toMatchObject({
        expenseDate: '2022-03-02',
        expenseTimeMinutes: 0,
      })
      expect(rows[1]).toMatchObject({
        expenseDate: '2022-03-02',
        expenseTimeMinutes: 12 * 60,
      })
    }),
  )

  it.effect(
    'defaults date-only values to noon like the unparsed fallback',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n2022-03-14,Meal,10\n2022-03-15T00:00,Snack,5',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
            },
          },
        }
        const rows = yield* previewDelimitedRows(table, mapping)
        expect(rows[0]?.expenseTimeMinutes).toBe(12 * 60)
        expect(rows[1]?.expenseTimeMinutes).toBe(0)
      }),
  )

  it.effect(
    'includes column context in mapping failures and date-order conflicts',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n13/01/2024,Decisive DMY,10\n01/13/2024,Decisive MDY,20',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
            },
          },
        }
        const rows = yield* previewDelimitedRows(table, mapping)
        const conflict = rows[0]?.issues.find(
          (issue) => issue.code === 'INCONSISTENT_DATE_ORDER',
        )
        expect(conflict?.message).toContain('13/01/2024')

        const badTable = yield* parseDelimitedText(
          'Date,Title,Debit,Credit\n2022-03-14,Cafe,5,6',
        )
        const badBase = sampleMapping(badTable)
        const badRows = yield* previewDelimitedRows(badTable, {
          ...badBase,
          mappings: {
            ...badBase.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'debit#1', fallbacks: [] }],
                transforms: [
                  {
                    kind: 'DEBIT_CREDIT',
                    debitColumn: 'debit#1',
                    creditColumn: 'credit#1',
                    format: 'AUTO',
                  },
                ],
              },
            },
          },
        })
        const failed = badRows[0]?.issues.find(
          (issue) => issue.code === 'MAPPING_FAILED',
        )
        expect(failed?.message).toContain('Mapping failed')
        expect(failed?.message).toContain('debit#1')
        expect(failed?.message).toContain('credit#1')
        expect(failed?.message).not.toContain('Both debit and credit')
        expect(failed?.message).not.toContain('No such key')
      }),
  )

  it.effect(
    'includes received values for invalid amounts and unsupported currencies',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount,Currency\n2022-03-14,Meal,not-a-number,XXX\n2022-03-15,Snack,10,ZZZ',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
              currency: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'currency#1', fallbacks: [] }],
                transforms: [{ kind: 'TRIM' }],
              },
            },
          },
          defaults: { currencyCode: 'USD', categoryId: 'general' },
        }
        const rows = yield* previewDelimitedRows(table, mapping)
        expect(
          rows[0]?.issues.find((issue) => issue.code === 'INVALID_AMOUNT')
            ?.message,
        ).toContain('not-a-number')
        expect(
          rows[1]?.issues.find((issue) => issue.code === 'UNSUPPORTED_CURRENCY')
            ?.message,
        ).toContain('ZZZ')
      }),
  )

  it.effect('caps long header keys and keeps them stable', () =>
    Effect.gen(function* () {
      const longHeader = `A${'x'.repeat(200)},Title,Amount`
      const firstTable = yield* parseDelimitedText(
        `${longHeader}\n2022-03-14,Meal,10`,
      )
      const secondTable = yield* parseDelimitedText(
        `${longHeader}\n2022-03-15,Snack,20`,
      )
      const firstKey = firstTable.columns[0]?.key ?? ''
      const secondKey = secondTable.columns[0]?.key ?? ''
      expect(firstKey).toBe(secondKey)
      const base = firstKey.split('#')[0] ?? ''
      expect(base.length).toBeLessThanOrEqual(128)
    }),
  )

  it.effect('allows DEBIT_CREDIT wrapped by SIGN_FROM_COLUMN', () =>
    Effect.gen(function* () {
      const combined: DelimitedVisualMapping = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'debit#1', fallbacks: [] }],
        transforms: [
          {
            kind: 'DEBIT_CREDIT',
            debitColumn: 'debit#1',
            creditColumn: 'credit#1',
            format: 'AUTO',
          },
          {
            kind: 'SIGN_FROM_COLUMN',
            columnKey: 'type#1',
            negativeValues: ['income'],
          },
        ],
      }
      expect(yield* validateDelimitedMapping(combined)).toEqual(combined)
      expect(compileDelimitedMapping(combined)).toContain('debitCredit(')
      expect(compileDelimitedMapping(combined)).toContain('absolute(')
      const table = yield* parseDelimitedText(
        'Date,Description,Debit,Credit,Type\n2022-03-14,Shop,100,,Expense\n2022-03-15,Refund,,50,Income',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'description#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: { mode: 'VISUAL', amount: combined },
        },
      })
      expect(rows.map((row) => row.amount)).toEqual([10000, -5000])
    }),
  )

  it.effect('fails fast on invalid visual combos in preview', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const base = sampleMapping(table)
      const invalid: DelimitedExpenseMappingV1 = {
        ...base,
        mappings: {
          ...base.mappings,
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [
                { kind: 'TRIM' },
                {
                  kind: 'DEBIT_CREDIT',
                  debitColumn: 'debit#1',
                  creditColumn: 'credit#1',
                  format: 'AUTO',
                },
              ],
            },
          },
        },
      }
      {
        const error = yield* Effect.flip(previewDelimitedRows(table, invalid))
        expect(error.message).toMatch(/only transformation/i)
      }
    }),
  )

  it.effect('reports AMBIGUOUS status when every date is ambiguous', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n05/06/2024,Meal,10\n07/08/2024,Snack,20',
      )
      const base = sampleMapping(table)
      const dateMapping: DelimitedExpenseMappingV1['mappings']['dateTime'] = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'date#1', fallbacks: [] }],
        transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
      }
      const analysis = analyzeDelimitedDateOrder(table, dateMapping, 'MDY')
      expect(analysis.status).toBe('AMBIGUOUS')
      expect(analysis.order).toBe('MDY')
      expect(analyzeDelimitedDateOrder(table, dateMapping, 'DMY').order).toBe(
        'DMY',
      )
      // The analyzed mapping is the sample's dateTime leg: guards against the
      // assertions above drifting away from the mapping under test.
      expect(base.mappings.dateTime).toEqual(dateMapping)
    }),
  )

  it.effect('round-trips portable JSON with bindings stripped', () =>
    Effect.gen(function* () {
      const table = yield* parseSample()
      const baseBindingsMapping = sampleMapping(table)
      const mapping = {
        ...baseBindingsMapping,
        categoryBindings: { food: 'food-and-drink' as const },
      }
      const portable = yield* portableDelimitedMapping(mapping)
      expect(portable.groupBindings).toBeUndefined()
      expect(portable.categoryBindings).toEqual({ food: 'food-and-drink' })
      expect(
        yield* parseDelimitedMappingJson(JSON.stringify(portable)),
      ).toEqual(portable)
    }),
  )

  it('profiles qualified currency symbols as money without ambiguity', () => {
    for (const input of ['CA$10', 'US$10', 'A$10', 'HK$10', 'R$10']) {
      expect(isDelimitedMoneyInput(input)).toBe(true)
    }
    expect(inspectDelimitedCurrency('CA$50')).toMatchObject({
      code: 'CAD',
      ambiguous: false,
    })
    expect(inspectDelimitedCurrency('US$10')).toMatchObject({
      code: 'USD',
      ambiguous: false,
    })
    // A bare shared symbol stays ambiguous.
    expect(inspectDelimitedCurrency('$50')).toMatchObject({ ambiguous: true })
  })

  it('rejects opposite-separator decimals under explicit number formats', () => {
    expect(parseDelimitedNumber('1,5', 'DOT')).toBeNull()
    expect(parseDelimitedNumber('1.5', 'COMMA')).toBeNull()
    expect(parseDelimitedNumber('1,234.56', 'DOT')).toBe(1234.56)
    expect(parseDelimitedNumber('1.234,56', 'COMMA')).toBe(1234.56)
    expect(parseDelimitedNumber('12,34.56', 'DOT')).toBeNull()
    expect(parseDelimitedNumber('12.34,56', 'COMMA')).toBeNull()
  })

  it.effect('formats offset instants in UTC regardless of runtime zone', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n2024-01-02T01:00:00+02:00,Meal,10',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      })
      // 01:00+02:00 is 23:00 UTC the previous day.
      expect(rows[0]).toMatchObject({
        expenseDate: '2024-01-01',
        expenseTimeMinutes: 23 * 60,
      })
    }),
  )

  it.effect('parses two-digit-year and textual 12-hour times', () =>
    Effect.gen(function* () {
      const table = yield* parseDelimitedText(
        'Date,Title,Amount\n03/02/22 10:11 AM,Meal,10\n14-Mar-2022 10:11 AM,Snack,20',
      )
      const base = sampleMapping(table)
      const rows = yield* previewDelimitedRows(table, {
        ...base,
        mappings: {
          ...base.mappings,
          dateTime: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'date#1', fallbacks: [] }],
            transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
          },
          title: {
            mode: 'VISUAL',
            sourceValues: [{ primary: 'title#1', fallbacks: [] }],
            transforms: [{ kind: 'TRIM' }],
          },
          money: {
            mode: 'VISUAL',
            amount: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
            },
          },
        },
      })
      expect(rows[0]).toMatchObject({
        expenseDate: '2022-03-02',
        expenseTimeMinutes: 10 * 60 + 11,
      })
      expect(rows[1]).toMatchObject({
        expenseDate: '2022-03-14',
        expenseTimeMinutes: 10 * 60 + 11,
      })
      expect(
        rows.every(
          ({ issues }) =>
            !issues.some(
              (issue) =>
                issue.field === 'dateTime' && issue.severity === 'error',
            ),
        ),
      ).toBe(true)
    }),
  )

  it.effect(
    'parses textual dates with slash/dot separators and two-digit years',
    () =>
      Effect.gen(function* () {
        const table = yield* parseDelimitedText(
          'Date,Title,Amount\n14/Sep/2022,Meal,10\n14.Sep.2022,Snack,20\n14-Mar-22,Dinner,30\n"Mar 4, 22",Lunch,40',
        )
        const base = sampleMapping(table)
        const mapping: DelimitedExpenseMappingV1 = {
          ...base,
          mappings: {
            ...base.mappings,
            dateTime: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'date#1', fallbacks: [] }],
              transforms: [{ kind: 'PARSE_DATE', format: 'AUTO_MDY' }],
            },
            title: {
              mode: 'VISUAL',
              sourceValues: [{ primary: 'title#1', fallbacks: [] }],
              transforms: [{ kind: 'TRIM' }],
            },
            money: {
              mode: 'VISUAL',
              amount: {
                mode: 'VISUAL',
                sourceValues: [{ primary: 'amount#1', fallbacks: [] }],
                transforms: [{ kind: 'PARSE_NUMBER', format: 'AUTO' }],
              },
            },
          },
        }
        const rows = yield* previewDelimitedRows(table, mapping)
        expect(rows.map((row) => row.expenseDate)).toEqual([
          '2022-09-14',
          '2022-09-14',
          '2022-03-14',
          '2022-03-04',
        ])
        expect(
          rows.every(
            ({ issues }) =>
              !issues.some(
                (issue) =>
                  issue.field === 'dateTime' && issue.severity === 'error',
              ),
          ),
        ).toBe(true)
      }),
  )

  it.effect('rejects nested-quantifier regex and caps REPLACE strings', () =>
    Effect.gen(function* () {
      const base: DelimitedVisualMapping = {
        mode: 'VISUAL',
        sourceValues: [{ primary: 'title#1', fallbacks: [] }],
        transforms: [{ kind: 'TRIM' }],
      }
      {
        const nestedPlus = yield* Effect.flip(
          validateDelimitedMapping({
            ...base,
            transforms: [
              { kind: 'REGEX_EXTRACT', pattern: '(a+)+$', group: 0 },
            ],
          }),
        )
        expect(nestedPlus.message).toMatch(/Nested quantifiers/)
      }
      {
        const nestedAlt = yield* Effect.flip(
          validateDelimitedMapping({
            ...base,
            transforms: [
              { kind: 'REGEX_EXTRACT', pattern: '(a|aa)+$', group: 0 },
            ],
          }),
        )
        expect(nestedAlt.message).toMatch(/Nested quantifiers/)
      }
      yield* validateDelimitedMapping({
        ...base,
        transforms: [
          { kind: 'REGEX_EXTRACT', pattern: '(\\d+)-(\\d+)', group: 0 },
        ],
      })
      {
        const tooLong = yield* Effect.flip(
          validateDelimitedMapping({
            ...base,
            transforms: [
              { kind: 'REPLACE', search: 'x'.repeat(201), replacement: 'y' },
            ],
          }),
        )
        expect(tooLong.message).toBeTruthy()
      }
      yield* validateDelimitedMapping({
        ...base,
        transforms: [
          { kind: 'REPLACE', search: 'x'.repeat(200), replacement: 'y' },
        ],
      })
    }),
  )

  it('caps REGEX_EXTRACT input so a 1MB cell completes fast', () => {
    const mapping: DelimitedFieldMapping = {
      mode: 'VISUAL',
      sourceValues: [{ primary: 'title#1', fallbacks: [] }],
      transforms: [{ kind: 'REGEX_EXTRACT', pattern: '(\\d+)', group: 0 }],
    }
    const cell = `123 ${'a'.repeat(1_000_000)}`
    const start = Date.now()
    const result = evaluateDelimitedMapping(mapping, { 'title#1': cell })
    const elapsed = Date.now() - start
    expect(typeof result).toBe('string')
    expect(result).toContain('123')
    expect(elapsed).toBeLessThan(1000)
    expect(MAX_REGEX_EXTRACT_INPUT_CHARS).toBeLessThanOrEqual(5000)
  })

  it('rejects interior unicode dashes and unbalanced parentheses', () => {
    expect(parseDelimitedNumber('10−20', 'AUTO')).toBeNull()
    expect(parseDelimitedNumber('(100', 'AUTO')).toBeNull()
    expect(parseDelimitedNumber('100)', 'AUTO')).toBeNull()
    expect(parseDelimitedNumber('(100)', 'AUTO')).toBe(-100)
  })

  it.effect(
    'strips BOM mojibake and reports single-column files friendly',
    () =>
      Effect.gen(function* () {
        const bomFallback = decodeDelimitedBytes(
          new Uint8Array([0xef, 0xbb, 0xbf, 0xe9]).buffer as ArrayBuffer,
        )
        expect(bomFallback.encoding).toBe('WINDOWS-1252')
        expect(bomFallback.text).toBe('é')
        {
          const singleColumnError = yield* Effect.flip(
            parseDelimitedText('Title\nMeal\nSnack'),
          )
          expect(singleColumnError.message).toBe(
            'The header needs at least two named columns',
          )
          expect(singleColumnError.code).toBe('DELIMITED_NEEDS_TWO_COLUMNS')
        }
      }),
  )

  it('canonicalizes category source keys across spacing and punctuation', () => {
    expect(importCategorySourceKey('Food / Drinks')).toBe('food/drinks')
    expect(importCategorySourceKey('food/drinks')).toBe('food/drinks')
    expect(importCategorySourceKey('food drinks')).toBe('food/drinks')
    expect(importCategorySourceKey('  Food  ')).toBe('food')
  })
})
