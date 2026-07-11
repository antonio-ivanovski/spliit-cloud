const SPLITWISE_HEADER_LABELS = {
  date: ['Date', 'Fecha', 'Datum', 'Tanggal', 'Data', '日付', 'วันที่'],
  description: [
    'Description',
    'Descripción',
    'Beschreibung',
    'Keterangan',
    'Descrizione',
    '概要',
    'Omschrijving',
    'Opis',
    'Descrição',
    'Beskrivning',
    'คำอธิบาย',
  ],
  category: [
    'Category',
    'Categoría',
    'Catégorie',
    'Kategorie',
    'Kategori',
    'Categorie',
    'Categoria',
    'カテゴリ',
    'Kategoria',
    'หมวดหมู่',
  ],
  cost: [
    'Cost',
    'Coste',
    'Coût',
    'Kosten',
    'Biaya',
    'Costo',
    '費用',
    'Koszt',
    'Custo',
    'Kostnad',
    'ราคา',
  ],
  currency: [
    'Currency',
    'Moneda',
    'Devise',
    'Währung',
    'Mata uang',
    'Valuta',
    '通貨',
    'Waluta',
    'Moeda',
    'สกุลเงิน',
  ],
} as const

type SplitwiseHeader = readonly (string | undefined)[]

function normalizeHeaderLabel(value: string | undefined): string {
  return (value ?? '').trim().normalize('NFC')
}

const HEADER_LABEL_SETS = Object.fromEntries(
  Object.entries(SPLITWISE_HEADER_LABELS).map(([key, labels]) => [
    key,
    new Set(labels.map((label) => normalizeHeaderLabel(label))),
  ]),
) as {
  [K in keyof typeof SPLITWISE_HEADER_LABELS]: Set<string>
}

const TOTAL_BALANCE_LABELS = new Set(
  [
    'Total balance',
    'Saldo total',
    'Solde total',
    'Total saldo',
    'Bilancio totale',
    '合計残高',
    'Totaal saldo',
    'Całkowite saldo',
    'Totalsumma',
    'ยอดคงเหลือรวม',
    'Gesamtbilanz',
  ].map((label) => normalizeHeaderLabel(label).toLowerCase()),
)

/** Returns whether the first five columns use a supported Splitwise locale. */
export function isSplitwiseHeader(row: SplitwiseHeader): boolean {
  return (
    HEADER_LABEL_SETS.date.has(normalizeHeaderLabel(row[0])) &&
    HEADER_LABEL_SETS.description.has(normalizeHeaderLabel(row[1])) &&
    HEADER_LABEL_SETS.category.has(normalizeHeaderLabel(row[2])) &&
    HEADER_LABEL_SETS.cost.has(normalizeHeaderLabel(row[3])) &&
    HEADER_LABEL_SETS.currency.has(normalizeHeaderLabel(row[4]))
  )
}

export function isSplitwiseTotalBalanceLabel(value: string): boolean {
  return TOTAL_BALANCE_LABELS.has(normalizeHeaderLabel(value).toLowerCase())
}
