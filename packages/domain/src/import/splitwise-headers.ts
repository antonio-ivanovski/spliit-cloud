import {
  defineCoreLabels,
  isCoreLabel,
  normalizeHeaderLabel,
} from './header-map'

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

const HEADER_LABEL_SETS = defineCoreLabels(SPLITWISE_HEADER_LABELS)

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
    isCoreLabel(HEADER_LABEL_SETS, 'date', row[0]) &&
    isCoreLabel(HEADER_LABEL_SETS, 'description', row[1]) &&
    isCoreLabel(HEADER_LABEL_SETS, 'category', row[2]) &&
    isCoreLabel(HEADER_LABEL_SETS, 'cost', row[3]) &&
    isCoreLabel(HEADER_LABEL_SETS, 'currency', row[4])
  )
}

export function isSplitwiseTotalBalanceLabel(value: string): boolean {
  return TOTAL_BALANCE_LABELS.has(normalizeHeaderLabel(value).toLowerCase())
}
