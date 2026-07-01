import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tryParseSplitwiseCsv } from './splitwise-csv'
import type { NormalizedSource } from './types'

const HEADER = 'Date,Description,Category,Cost,Currency,John Doe,Jane Doe'

function splitwiseCsv(
  rows: Array<Array<string>>,
  header: string = HEADER,
): string {
  return [
    header,
    ...rows.map((r) =>
      r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','),
    ),
  ].join('\n')
}

function readFixture(name: string): string {
  return readFileSync(join(__dirname, '../fixtures', name), 'utf-8')
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuotes = !inQuotes
    else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

interface TotalBalance {
  currency: string
  balances: Record<number, number>
}

function extractTotalBalances(csv: string): TotalBalance[] {
  const result: TotalBalance[] = []
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    if (cells[1]?.trim().toLowerCase() !== 'total balance') continue
    const currency = cells[4]?.trim().toUpperCase()
    if (currency?.length !== 3) continue
    const balances: Record<number, number> = {}
    for (let i = 5; i < cells.length; i++) {
      const v = parseFloat(cells[i]?.trim() ?? '')
      if (!isNaN(v)) balances[i] = Math.round(v * 100)
    }
    result.push({ currency, balances })
  }
  return result
}

/** Recompute per-currency balances from parsed expenses so they can be
 *  compared against the CSV's Total balance footer rows. */
function computeBalancesByCurrency(
  source: NormalizedSource,
): Map<string, Record<string, number>> {
  const result = new Map<string, Record<string, number>>()
  for (const e of source.expenses) {
    const currency = e.amountCurrency ?? source.currencyCode ?? ''
    let balances = result.get(currency)
    if (!balances) {
      balances = {}
      for (const p of source.participants) balances[p.sourceId] = 0
      result.set(currency, balances)
    }
    for (const paidBy of e.paidBy) {
      balances[paidBy.sourceId] =
        (balances[paidBy.sourceId] ?? 0) + paidBy.shares
    }
    for (const p of e.paidFor) {
      balances[p.sourceId] = (balances[p.sourceId] ?? 0) - p.shares
    }
  }
  return result
}

// ----- helpers that resolve sourceId from participant order -----
function aid(result: NormalizedSource, idx: number) {
  return result.participants[idx].sourceId
}
function pf(aid: string, shares: number) {
  return { sourceId: aid, shares }
}

describe('tryParseSplitwiseCsv', () => {
  it('parses a representative Splitwise CSV with two participants, MKD-only rows', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Pazarenje',
        'General',
        '360.00',
        'MKD',
        '180.00',
        '-180.00',
      ],
      ['2026-01-16', 'Market', 'General', '240.00', 'MKD', '-120.00', '120.00'],
      ['2026-01-17', 'Kafe', 'General', '120.00', 'MKD', '60.00', '-60.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const s = result.source
    expect(s.participants).toHaveLength(2)
    expect(s.participants[0].sourceName).toBe('John Doe')
    expect(s.participants[1].sourceName).toBe('Jane Doe')
    expect(s.expenses).toHaveLength(3)

    // Row 1: Antonio +180 / Dejan -180 → even split
    const e1 = s.expenses[0]
    expect(e1.title).toBe('Pazarenje')
    expect(e1.amount).toBe(36000)
    expect(e1.splitMode).toBe('EVENLY')
    expect(e1.paidBySourceId).toBe(aid(s, 0))
    expect(e1.paidFor).toEqual([pf(aid(s, 1), 18000), pf(aid(s, 0), 18000)])
    expect(e1.amountCurrency).toBe('MKD')
    expect(e1.originalCurrency).toBeNull()

    // Row 2: Antonio -120 / Dejan +120 → Dejan payer
    const e2 = s.expenses[1]
    expect(e2.paidBySourceId).toBe(aid(s, 1))
    expect(e2.splitMode).toBe('EVENLY')
    expect(e2.paidFor).toEqual([pf(aid(s, 0), 12000), pf(aid(s, 1), 12000)])

    // Row 3: Antonio +60 / Dejan -60 → even split
    const e3 = s.expenses[2]
    expect(e3.paidBySourceId).toBe(aid(s, 0))
    expect(e3.splitMode).toBe('EVENLY')
    expect(e3.paidFor).toEqual([pf(aid(s, 1), 6000), pf(aid(s, 0), 6000)])
  })

  it('preserves per-row currency (multi-currency CSV)', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'MKD Expense',
        'General',
        '100.00',
        'MKD',
        '50.00',
        '-50.00',
      ],
      [
        '2026-01-16',
        'EUR Expense',
        'General',
        '50.00',
        'EUR',
        '-25.00',
        '25.00',
      ],
      [
        '2026-01-17',
        'USD Expense',
        'General',
        '75.00',
        'USD',
        '37.50',
        '-37.50',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(3)
    expect(result.source.expenses[0].amountCurrency).toBe('MKD')
    expect(result.source.expenses[0].originalCurrency).toBeNull()
    expect(result.source.expenses[0].originalAmount).toBeNull()
    expect(result.source.expenses[1].amountCurrency).toBe('EUR')
    expect(result.source.expenses[1].originalCurrency).toBeNull()
    expect(result.source.expenses[1].originalAmount).toBeNull()
    expect(result.source.expenses[2].amountCurrency).toBe('USD')
    expect(result.source.expenses[2].originalCurrency).toBeNull()
    expect(result.source.expenses[2].originalAmount).toBeNull()
  })

  it('skips Total balance rows', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Pazarenje',
        'General',
        '360.00',
        'MKD',
        '360.00',
        '-180.00',
      ],
      ['2026-06-30', 'Total balance', '', '', 'MKD', '0.00', '0.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(1)
  })

  it('skips case-insensitive TOTAL BALANCE and total balance rows', () => {
    for (const label of ['TOTAL BALANCE', 'total balance']) {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Pazarenje',
          'General',
          '360.00',
          'MKD',
          '360.00',
          '-180.00',
        ],
        ['2026-06-30', label, '', '', 'MKD', '0.00', '0.00'],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(1)
    }
  })

  it('skips preamble lines before header', () => {
    const csv =
      'Note: does not include group expenses\n\n' +
      splitwiseCsv([
        [
          '2026-01-15',
          'Pazarenje',
          'General',
          '360.00',
          'MKD',
          '360.00',
          '-180.00',
        ],
      ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(1)
  })

  it('marks Payment category rows as reimbursements', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Payment Reimb',
        'Payment',
        '50.00',
        'MKD',
        '50.00',
        '0.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].isReimbursement).toBe(true)
    expect(result.source.expenses[0].category).toBe('payment')
  })

  it('marks "<Name> I. paid <Name> I." description as reimbursement', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Jane D. paid John D.',
        'General',
        '20.00',
        'MKD',
        '20.00',
        '0.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].isReimbursement).toBe(true)
  })

  it('does NOT mark ordinary expenses as reimbursements', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Pazarenje', 'General', '30.00', 'MKD', '15.00', '-15.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].isReimbursement).toBe(false)
  })

  it('handles a real-style reimbursement row with both payer and receiver columns', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'John D. paid Jane D.',
        'General',
        '50.00',
        'MKD',
        '50.00',
        '-50.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const e = result.source.expenses[0]
    expect(e.isReimbursement).toBe(true)
    expect(e.amount).toBe(5000)
    expect(e.paidBySourceId).toBe(aid(result.source, 0))
    // receiver is Dejan (negative), payer consumed nothing
    expect(e.paidFor).toEqual([pf(aid(result.source, 1), 5000)])
  })

  it('handles Payment-category reimbursement with positive+negative columns', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Settle up',
        'Payment',
        '120.00',
        'MKD',
        '120.00',
        '-120.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const e = result.source.expenses[0]
    expect(e.isReimbursement).toBe(true)
    expect(e.category).toBe('payment')
    expect(e.amount).toBe(12000)
    expect(e.paidFor).toEqual([pf(aid(result.source, 1), 12000)])
  })

  it('maps known categories correctly', () => {
    const categoryRows: Array<[string, string]> = [
      ['Groceries', 'groceries'],
      ['TV/Phone/Internet', 'tv-phone-internet'],
      ['Gas/fuel', 'gas-fuel'],
      ['Electronics', 'electronics'],
      ['Water', 'water'],
      ['Heat/gas', 'heat-gas'],
      ['Parking', 'parking'],
      ['Mortgage', 'mortgage'],
    ]
    const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
      `2026-01-${String(i + 15).padStart(2, '0')}`,
      `Cat ${cat}`,
      cat,
      '10.00',
      'MKD',
      '5.00',
      '-5.00',
    ])
    const csv = splitwiseCsv(rows)
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses).toHaveLength(categoryRows.length)
    for (let i = 0; i < categoryRows.length; i++) {
      expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
    }
  })

  it('splits custom "X - Y" category strings', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Home Other',
        'Home - Other',
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].category).toBe('home')
  })

  it('falls back to general for unknown categories', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Future',
        'FutureSplitwiseCategory',
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].category).toBe('general')
  })

  describe('German locale categories', () => {
    it('maps German flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Allgemein', 'general'],
        ['Lebensmittel', 'groceries'],
        ['Alkohol', 'liquor'],
        ['Restaurant', 'dining-out'],
        ['Elektronik', 'electronics'],
        ['Miete', 'rent'],
        ['Möbel', 'furniture'],
        ['Treibstoff', 'gas-fuel'],
        ['Kino', 'movies'],
        ['Spiele', 'games'],
        ['Sport', 'sports'],
        ['Bildung', 'education'],
        ['Kleidung', 'clothing'],
        ['Versicherung', 'insurance'],
        ['Steuern', 'taxes'],
        ['Wasser', 'water'],
        ['Elektrizität', 'electricity'],
        ['Müll', 'trash'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${cat}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles German "Parent - Sonstiges" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Essen Other',
          'Essen und Trinken - Sonstiges',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
    })

    it('handles German "Parent - Sonstiges" for other parent groups', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Home Other',
          'Zuhause - Sonstiges',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Transport Other',
          'Verkehrsmittel - Sonstiges',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('home')
      expect(result.source.expenses[1].category).toBe('transportation')
    })

    it('falls back standalone "Sonstiges" to general', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Other standalone',
          'Sonstiges',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('general')
    })
  })

  describe('Spanish locale categories', () => {
    it('maps Spanish flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Alimentos', 'groceries'],
        ['Licor', 'liquor'],
        ['Restaurantes', 'dining-out'],
        ['Gasolina', 'gas-fuel'],
        ['Películas', 'movies'],
        ['Juegos', 'games'],
        ['Música', 'music'],
        ['Deportes', 'sports'],
        ['Impuestos', 'taxes'],
        ['Seguro', 'insurance'],
        ['Agua', 'water'],
        ['Electricidad', 'electricity'],
        ['Basura', 'trash'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${cat}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Spanish "Parent - Otro" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'Comidas y bebidas - Otro',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Home Other',
          'Casa - Otro',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
      expect(result.source.expenses[1].category).toBe('home')
    })
  })

  describe('French locale categories', () => {
    it('maps French flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Alcool', 'liquor'],
        ['Courses', 'groceries'],
        ['Sorties', 'dining-out'],
        ['Essence', 'gas-fuel'],
        ['Cinéma', 'movies'],
        ['Jeux', 'games'],
        ['Musique', 'music'],
        ['Vêtements', 'clothing'],
        ['Eau', 'water'],
        ['Électricité', 'electricity'],
        ['Poubelles', 'trash'],
        ['Scolarité', 'education'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${cat}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles French "Parent - Autre" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'Nourriture et boissons - Autre',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Transport Other',
          'Transport - Autre',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
      expect(result.source.expenses[1].category).toBe('transportation')
    })
  })

  describe('Indonesian locale categories', () => {
    it('maps Indonesian flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Umum', 'general'],
        ['BBM', 'gas-fuel'],
        ['Mobil', 'car'],
        ['Pesawat', 'plane'],
        ['Listrik', 'electricity'],
        ['Sampah', 'trash'],
        ['Air', 'water'],
        ['Pajak', 'taxes'],
        ['Hadiah', 'gifts'],
        ['Edukasi', 'education'],
        ['Sewa', 'rent'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${cat}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Indonesian "Parent - Lainnya" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'Makanan dan minuman - Lainnya',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Home Other',
          'Rumah - Lainnya',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
      expect(result.source.expenses[1].category).toBe('home')
    })
  })

  describe('Italian locale categories', () => {
    it('maps Italian flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Alimentari', 'groceries'],
        ['Alcolici', 'liquor'],
        ['Ristorante', 'dining-out'],
        ['Carburante', 'gas-fuel'],
        ['Cinema', 'movies'],
        ['Giochi', 'games'],
        ['Musica', 'music'],
        ['Abbigliamento', 'clothing'],
        ['Acqua', 'water'],
        ['Spazzatura', 'trash'],
        ['Pulizie', 'cleaning'],
        ['Tasse', 'taxes'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${cat}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Italian "Parent - Altro" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'Cibo e bevande - Altro',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Utility Other',
          'Utenze - Altro',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
      expect(result.source.expenses[1].category).toBe('utilities')
    })
  })

  describe('Japanese locale categories', () => {
    it('maps Japanese flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['食料品', 'groceries'],
        ['お酒', 'liquor'],
        ['外食', 'dining-out'],
        ['電気', 'electricity'],
        ['水道', 'water'],
        ['映画', 'movies'],
        ['音楽', 'music'],
        ['税金', 'taxes'],
        ['自転車', 'bicycle'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses).toHaveLength(categoryRows.length)
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Japanese "Parent - その他" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          '飲食 - その他',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
        [
          '2026-01-16',
          'Home Other',
          '自宅 - その他',
          '15.00',
          'MKD',
          '7.50',
          '-7.50',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
      expect(result.source.expenses[1].category).toBe('home')
    })
  })

  describe('Dutch locale categories', () => {
    it('maps Dutch flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Boodschappen', 'groceries'],
        ['Drank', 'liquor'],
        ['Uit eten', 'dining-out'],
        ['Brandstof', 'gas-fuel'],
        ['Elektriciteit', 'electricity'],
        ['Belasting', 'taxes'],
        ['Onderwijs', 'education'],
        ['Huisdieren', 'pets'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Dutch "Parent - Andere" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Home Other',
          'Huis - Andere',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('home')
    })
  })

  describe('Polish locale categories', () => {
    it('maps Polish flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Artykuły spożywcze', 'groceries'],
        ['Jedzenie na mieście', 'dining-out'],
        ['Paliwo', 'gas-fuel'],
        ['Prąd', 'electricity'],
        ['Podatki', 'taxes'],
        ['Prezenty', 'gifts'],
        ['Edukacja', 'education'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Polish "Parent - Inne" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Home Other',
          'Dom - Inne',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('home')
    })
  })

  describe('Portuguese (Brasil) locale categories', () => {
    it('maps pt-BR flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Mercado', 'groceries'],
        ['Bebidas alcoólicas', 'liquor'],
        ['Jantar fora', 'dining-out'],
        ['Combustível', 'gas-fuel'],
        ['Aluguel', 'rent'],
        ['Eletricidade', 'electricity'],
        ['Impostos', 'taxes'],
        ['Presentes', 'gifts'],
        ['Creche', 'childcare'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles pt-BR "Parent - Outros" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'Comidas e bebidas - Outros',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
    })
  })

  describe('Portuguese (Portugal) locale categories', () => {
    it('maps pt-PT flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Mercearia', 'groceries'],
        ['Bebida', 'liquor'],
        ['Jantar', 'dining-out'],
        ['Combustível', 'gas-fuel'],
        ['Desporto', 'sports'],
        ['Ensino', 'education'],
        ['Prendas', 'gifts'],
        ['Puericultura', 'childcare'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles pt-PT "Parent - Outro" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Transport Other',
          'Transportes - Outro',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('transportation')
    })
  })

  describe('Thai locale categories', () => {
    it('maps Thai flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['อาหารและเครื่องดื่ม', 'food-and-drink'],
        ['ของชำ', 'groceries'],
        ['สุรา', 'liquor'],
        ['ไฟฟ้า', 'electricity'],
        ['ขยะ', 'trash'],
        ['ค่าใช้จ่ายทางการแพทย์', 'medical-expenses'],
        ['การศึกษา', 'education'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Thai "Parent - อื่นๆ" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Food Other',
          'อาหารและเครื่องดื่ม - อื่นๆ',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('food-and-drink')
    })
  })

  describe('Swedish locale categories', () => {
    it('maps Swedish flat category names correctly', () => {
      const categoryRows: Array<[string, string]> = [
        ['Livsmedel', 'groceries'],
        ['Restaurangbesök', 'dining-out'],
        ['Bensin/bränsle', 'gas-fuel'],
        ['Hyra', 'rent'],
        ['Försäkringar', 'insurance'],
        ['Kläder', 'clothing'],
        ['Utbildning', 'education'],
        ['Hotell', 'hotel'],
        ['Avfall', 'trash'],
      ]
      const rows: Array<Array<string>> = categoryRows.map(([cat], i) => [
        `2026-01-${String(i + 15).padStart(2, '0')}`,
        `Cat ${i}`,
        cat,
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ])
      const csv = splitwiseCsv(rows)
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (let i = 0; i < categoryRows.length; i++) {
        expect(result.source.expenses[i].category).toBe(categoryRows[i][1])
      }
    })

    it('handles Swedish "Parent - Övrigt" as fallback to parent group', () => {
      const csv = splitwiseCsv([
        [
          '2026-01-15',
          'Home Other',
          'Hem - Övrigt',
          '10.00',
          'MKD',
          '5.00',
          '-5.00',
        ],
      ])
      const result = tryParseSplitwiseCsv(csv)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.source.expenses[0].category).toBe('home')
    })
  })

  it('rejects non-Splitwise CSV header (Spliit-shaped header)', () => {
    const spliitHeader =
      'Date,Description,Category,Currency,Cost,John Doe,Jane Doe'
    const csv = splitwiseCsv(
      [
        [
          '2026-01-15',
          'Pazarenje',
          'General',
          '360.00',
          'MKD',
          '360.00',
          '-180.00',
        ],
      ],
      spliitHeader,
    )
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Splitwise export/i)
  })

  it('rejects empty CSV', () => {
    const result = tryParseSplitwiseCsv('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no data rows/i)
  })

  it('rejects header-only CSV', () => {
    const result = tryParseSplitwiseCsv(HEADER)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no data rows/i)
  })

  it('rejects CSV with no participant columns', () => {
    const csv =
      'Date,Description,Category,Cost,Currency\n' +
      '2026-01-15,Pazarenje,General,360.00,MKD'
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/missing participant/i)
  })

  it('skips rows with unparseable Cost', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Bad', 'General', 'abc', 'MKD', '100.00', '0.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no parseable expenses/i)
  })

  it('skips rows with no positive-value participant (no payer)', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'NoPayer', 'General', '100.00', 'MKD', '0.00', '0.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no parseable expenses/i)
  })

  it('picks the largest positive-value column as payer', () => {
    // Antonio +60, Dejan -40 → Antonio is payer
    const csvAntonio = splitwiseCsv([
      [
        '2026-01-15',
        'PayerTest',
        'General',
        '100.00',
        'MKD',
        '60.00',
        '-40.00',
      ],
    ])
    const result1 = tryParseSplitwiseCsv(csvAntonio)
    expect(result1.ok).toBe(true)
    if (!result1.ok) return
    expect(result1.source.expenses[0].paidBySourceId).toBe(
      aid(result1.source, 0),
    )

    // Antonio -40, Dejan +60 → Dejan is payer
    const csvDejan = splitwiseCsv([
      [
        '2026-01-15',
        'PayerTest',
        'General',
        '100.00',
        'MKD',
        '-40.00',
        '60.00',
      ],
    ])
    const result2 = tryParseSplitwiseCsv(csvDejan)
    expect(result2.ok).toBe(true)
    if (!result2.ok) return
    expect(result2.source.expenses[0].paidBySourceId).toBe(
      aid(result2.source, 1),
    )
  })

  it('trims trailing whitespace from Description', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Pazarenje ', 'General', '10.00', 'MKD', '5.00', '-5.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].title).toBe('Pazarenje')
  })

  it('paidFor shares sum exactly to the cost (no drift)', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Drift', 'General', '100.00', 'MKD', '66.67', '-66.67'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const e = result.source.expenses[0]
    expect(e.amount).toBe(10000)
    const sum = e.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(10000)
  })

  it('detects even splits', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Even', 'General', '120.00', 'MKD', '-60.00', '60.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].splitMode).toBe('EVENLY')
  })

  it('uses BY_AMOUNT for uneven splits', () => {
    const csv = splitwiseCsv([
      ['2026-01-15', 'Uneven', 'General', '100.00', 'MKD', '60.00', '-40.00'],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].splitMode).toBe('BY_AMOUNT')
  })

  it('sets sourceUrl to null and detects the most common currency', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Pazarenje',
        'General',
        '360.00',
        'MKD',
        '180.00',
        '-180.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.sourceUrl).toBeNull()
    expect(result.source.currencyCode).toBe('MKD')
    expect(result.source.currency).toBe('MKD')
    expect(result.source.sourceGroupId).toBe('splitwise-csv-import')
    expect(result.source.name).toBe('Imported from Splitwise')
  })

  it('handles quoted descriptions with embedded commas', () => {
    const csv = splitwiseCsv([
      [
        '2026-01-15',
        'Maici, gakji',
        'General',
        '10.00',
        'MKD',
        '5.00',
        '-5.00',
      ],
    ])
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.expenses[0].title).toBe('Maici, gakji')
  })
})

describe('tryParseSplitwiseCsv with fixtures', () => {
  function assertBalancesMatchFooter(csv: string) {
    const result = tryParseSplitwiseCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const totalBalances = extractTotalBalances(csv)
    const computed = computeBalancesByCurrency(result.source)
    expect(totalBalances.length).toBeGreaterThan(0)
    for (const { currency, balances: expected } of totalBalances) {
      const got = computed.get(currency)
      if (!got) continue
      for (const [colStr, expectedCents] of Object.entries(expected)) {
        const colIdx = Number(colStr) - 5
        const participant = result.source.participants[colIdx]
        const actualCents = got[participant.sourceId] ?? 0
        expect(Math.abs(actualCents - expectedCents)).toBeLessThanOrEqual(1)
      }
    }
  }

  it('group export CSV: per-currency balances match the Total balance footer', () => {
    assertBalancesMatchFooter(readFixture('_2026-06-30_export.csv'))
  })

  it('personal export CSV: per-currency balances match the Total balance footer', () => {
    assertBalancesMatchFooter(
      readFixture('john-i-and-jane-i_2026-06-30_export copy.csv'),
    )
  })

  it('multi-payer export CSV: per-currency balances match the Total balance footer', () => {
    assertBalancesMatchFooter(readFixture('splitwise-multi-payer.csv'))
  })

  it('group export CSV: picks MKD as the most common currency', () => {
    const result = tryParseSplitwiseCsv(readFixture('_2026-06-30_export.csv'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.currencyCode).toBe('MKD')
  })

  it('personal export CSV: picks MKD as the most common currency', () => {
    const result = tryParseSplitwiseCsv(
      readFixture('john-i-and-jane-i_2026-06-30_export copy.csv'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.currencyCode).toBe('MKD')
  })
})
