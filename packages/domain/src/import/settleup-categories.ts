import type { CategoryId } from '../categories'

/**
 * Settle Up transaction categories.
 *
 * Settle Up stores the category as an emoji (one of its built-in defaults, or a
 * user-picked emoji for custom categories whose display name lives in the
 * per-group `/groupCategories` map — which the CSV export does not carry). The
 * export's category cell therefore holds either an emoji or a free-text name,
 * in any locale.
 *
 * This module resolves both: exact emoji → id for the built-in set (emoji are
 * locale-independent), then a keyword heuristic over free-text names in the
 * Cospend style, falling back to `general`. Transfer rows and income (negative
 * totals) are handled by the parser, not here.
 */

// ── Built-in emoji set ────────────────────────────────────────────────
// Source: Settle Up Android/Web default category list (`🍽` food,
// `🛒` groceries, `☕` drinks, `🏠` home, `🚗` transport, `✈` travel,
// `🎭` entertainment, `⚽` sports, `💊` health, `👶` children, `🐾` pets,
// `💡` utilities, `📱` electronics/phone, `👕` clothing, `🎁` gifts,
// `📚` education, `💰` money/income, `🏦` bank/transfer, `❓` other).
// Unknown emoji still resolve via the keyword pass on the raw cell text
// (a custom display name), so the map only needs the unambiguous ones.
const EMOJI_MAP: Record<string, CategoryId> = {
  '🍽': 'dining-out',
  '🍴': 'dining-out',
  '🍔': 'dining-out',
  '🍕': 'dining-out',
  '🍺': 'liquor',
  '🍷': 'liquor',
  '🍸': 'liquor',
  '☕': 'food-and-drink',
  '🍵': 'food-and-drink',
  '🍰': 'food-and-drink',
  '🛒': 'groceries',
  '🏠': 'home',
  '🏡': 'home',
  '🔑': 'rent',
  '🛏': 'hotel',
  '🏨': 'hotel',
  '🚗': 'car',
  '⛽': 'gas-fuel',
  '🅿': 'parking',
  '🚕': 'taxi',
  '✈': 'plane',
  '🚂': 'bus-train',
  '🚌': 'bus-train',
  '🚲': 'bicycle',
  '🎭': 'entertainment',
  '🎬': 'movies',
  '🎮': 'games',
  '🎵': 'music',
  '⚽': 'sports',
  '🏋': 'sports',
  '🎉': 'events-and-activities',
  '🎄': 'events-and-activities',
  '💊': 'medical-expenses',
  '🏥': 'medical-expenses',
  '🩺': 'medical-expenses',
  '👶': 'childcare',
  '🐾': 'pets',
  '🐶': 'pets',
  '🐱': 'pets',
  '💡': 'electricity',
  '💧': 'water',
  '🔥': 'heat-gas',
  '📱': 'electronics',
  '💻': 'electronics',
  '📺': 'electronics',
  '👕': 'clothing',
  '👗': 'clothing',
  '🎁': 'gifts',
  '📚': 'education',
  '🎓': 'education',
  '💰': 'income',
  '💵': 'income',
  '💸': 'income',
  '🏦': 'general',
  '💳': 'general',
  '🧾': 'general',
  '❓': 'general',
  '📦': 'general',
  '✏': 'general',
}

const KEYWORDS: Array<[readonly string[], CategoryId]> = [
  // Food & drink
  [
    [
      'grocer',
      'supermarket',
      'lebensmittel',
      'supermarkt',
      'supermarché',
      'courses',
      'supermercato',
      'supermercado',
    ],
    'groceries',
  ],
  [
    [
      'restaurant',
      'dining',
      'essen',
      'kantine',
      'cafe',
      'café',
      'pizzeria',
      'pizza',
      'bistro',
      'bar',
      'pub',
      'gaststätte',
    ],
    'dining-out',
  ],
  [
    [
      'drink',
      'drinks',
      'getränk',
      'getränke',
      'bier',
      'alcohol',
      'alkohol',
      'liquor',
      'boisson',
    ],
    'liquor',
  ],
  [
    ['food', 'snack', 'nourriture', 'alimentation', 'cibo', 'comida'],
    'food-and-drink',
  ],
  // Home
  [['rent', 'miete', 'loyer', 'affitto', 'alquiler', 'huur'], 'rent'],
  [
    [
      'hotel',
      'hostel',
      'motel',
      'airbnb',
      'lodging',
      'accommodation',
      'unterkunft',
      'hôtel',
    ],
    'hotel',
  ],
  [['home', 'house', 'zuhause', 'maison', 'casa', 'huis', 'wohnung'], 'home'],
  [
    ['cleaning', 'reinigung', 'nettoyage', 'huishouden', 'household'],
    'household-supplies',
  ],
  // Transportation
  [['taxi', 'uber'], 'taxi'],
  [
    ['fuel', 'kraftstoff', 'benzin', 'essence', 'carburante', 'gas'],
    'gas-fuel',
  ],
  [['parking', 'parken', 'stationnement', 'parcheggio'], 'parking'],
  [['train', 'bus', 'bahn', 'zug', 'treno', 'autobus', 'public'], 'bus-train'],
  [['flight', 'flug', 'flughafen', 'plane', 'vol', 'avion', 'aereo'], 'plane'],
  [
    [
      'car',
      'auto',
      'kfz',
      'fahrzeug',
      'voiture',
      'macchina',
      'coche',
      'bicycle',
      'bike',
      'fahrrad',
      'vélo',
    ],
    'car',
  ],
  [
    [
      'transport',
      'transportation',
      'verkehr',
      'reise',
      'trip',
      'travel',
      'voyage',
      'viaggio',
      'viaje',
    ],
    'transportation',
  ],
  // Life
  [['insurance', 'versicherung', 'assurance', 'assicurazione'], 'insurance'],
  [
    [
      'medical',
      'health',
      'gesundheit',
      'arzt',
      'apotheke',
      'santé',
      'salute',
      'doctor',
      'pharmacy',
    ],
    'medical-expenses',
  ],
  [['tax', 'taxes', 'steuer', 'impôt', 'tasse'], 'taxes'],
  [
    ['child', 'kinder', 'kita', 'enfant', 'bambino', 'school', 'education'],
    'childcare',
  ],
  [
    ['clothing', 'kleidung', 'vêtement', 'vestiti', 'ropa', 'kleding'],
    'clothing',
  ],
  [['gift', 'gifts', 'geschenk', 'cadeau', 'regalo', 'regalo'], 'gifts'],
  // Entertainment
  [['movie', 'movies', 'kino', 'cinema', 'film'], 'movies'],
  [['music', 'musik', 'musique', 'concert'], 'music'],
  [['sport', 'sports', 'fitness', 'gym'], 'sports'],
  [['game', 'games', 'spiel', 'jeu', 'gioco'], 'games'],
  [
    [
      'event',
      'events',
      'activity',
      'ausflug',
      'freizeit',
      'hobby',
      'entertainment',
      'loisir',
    ],
    'events-and-activities',
  ],
  // Utilities / services
  [['electricity', 'strom', 'energie', 'energy', 'électricité'], 'electricity'],
  [['water', 'wasser', 'eau', 'acqua'], 'water'],
  [['internet', 'tv', 'telefon', 'phone', 'téléphone'], 'tv-phone-internet'],
  [['utility', 'utilities', 'nebenkosten'], 'utilities'],
  [['service', 'services', 'dienstleistung'], 'services'],
  // Income
  [['salary', 'einkommen', 'income', 'lohn', 'gehalt', 'salaire'], 'income'],
  // Settlement / transfer
  [
    [
      'transfer',
      'transfert',
      'überweisung',
      'repayment',
      'reimbursement',
      'rückzahlung',
      'ausgleich',
      'settlement',
      'refund',
      'remboursement',
      'rimborso',
      'reembolso',
    ],
    'settlement',
  ],
]

/**
 * Settlement markers: Settle Up `transfer` rows and transfer-like titles.
 * Mirrors the Tricount settlement-title list so both importers agree on what
 * "looks like a repayment" means for title fallback detection.
 */
const SETTLEMENT_TITLES = [
  'repayment',
  'reimbursement',
  'reimbursment',
  'refund',
  'transfer',
  'transfert',
  'settlement',
  'remboursement',
  'recouvrement de dette',
  'money transfer',
  'repayment',
  'rückzahlung',
  'ausgleich',
]

/** Transfer type labels that mark a row as a settlement. */
const TRANSFER_TYPES = new Set([
  'transfer',
  'transfert',
  'virement',
  'trasferimento',
  'transferencia',
])

export function settleUpCategoryToId(
  category: string,
  transactionType: string,
): CategoryId {
  if (TRANSFER_TYPES.has(transactionType.trim().toLowerCase()))
    return 'settlement'
  const trimmed = category.trim()
  if (trimmed !== '') {
    // Bare emoji cells match exactly (normalize variant selectors away).
    const emoji = trimmed.normalize('NFC').replace(/️/g, '')
    if (EMOJI_MAP[emoji]) return EMOJI_MAP[emoji]!
    if (EMOJI_MAP[trimmed]) return EMOJI_MAP[trimmed]!
    const normalized = trimmed.toLowerCase()
    for (const [keywords, categoryId] of KEYWORDS) {
      if (
        keywords.some((keyword) => {
          if (normalized === keyword) return true
          const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const pattern = new RegExp(
            `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
            'u',
          )
          return pattern.test(normalized)
        })
      ) {
        return categoryId
      }
    }
  }
  return 'general'
}

/** Title-keyword fallback for settlement detection on transfer-like rows. */
export function looksLikeSettlementTitle(title: string): boolean {
  const lower = title.toLowerCase()
  return SETTLEMENT_TITLES.some((marker) => lower.includes(marker))
}
