import type { CategoryId } from '../categories'

/**
 * Tricount built-in categories (EN/FR + common equivalents). Unknown or
 * `UNCATEGORIZED` values fall back to `general`; custom categories are resolved
 * by the caller before reaching this map.
 */
const CATEGORY_MAP: Record<string, CategoryId> = {
  // ── English ──────────────────────────────────────────────────────────
  uncategorized: 'general',
  'no category': 'general',
  other: 'general',
  food: 'food-and-drink',
  'food and drink': 'food-and-drink',
  restaurant: 'dining-out',
  groceries: 'groceries',
  drinks: 'liquor',
  housing: 'home',
  rent: 'rent',
  household: 'household-supplies',
  transport: 'transportation',
  transportation: 'transportation',
  car: 'car',
  'gas/fuel': 'gas-fuel',
  fuel: 'gas-fuel',
  parking: 'parking',
  taxi: 'taxi',
  plane: 'plane',
  train: 'bus-train',
  bus: 'bus-train',
  hotel: 'hotel',
  accommodation: 'hotel',
  holidays: 'hotel',
  travel: 'transportation',
  entertainment: 'entertainment',
  leisure: 'entertainment',
  sport: 'sports',
  sports: 'sports',
  culture: 'entertainment',
  movies: 'movies',
  music: 'music',
  games: 'games',
  shopping: 'clothing',
  clothes: 'clothing',
  clothing: 'clothing',
  health: 'medical-expenses',
  medical: 'medical-expenses',
  education: 'education',
  gifts: 'gifts',
  services: 'services',
  utilities: 'utilities',
  electricity: 'electricity',
  water: 'water',
  internet: 'electronics',
  phone: 'electronics',
  insurance: 'insurance',
  taxes: 'taxes',
  pets: 'pets',
  childcare: 'childcare',
  // ── French ───────────────────────────────────────────────────────────
  nourriture: 'food-and-drink',
  alimentation: 'groceries',
  courses: 'groceries',
  restaurant2: 'dining-out',
  logement: 'home',
  loyer: 'rent',
  ménage: 'household-supplies',
  menage: 'household-supplies',
  voiture: 'car',
  essence: 'gas-fuel',
  carburant: 'gas-fuel',
  avion: 'plane',
  hôtel: 'hotel',
  hotel2: 'hotel',
  vacances: 'hotel',
  voyage: 'transportation',
  loisirs: 'entertainment',
  divertissement: 'entertainment',
  sorties: 'dining-out',
  vêtements: 'clothing',
  vetements: 'clothing',
  santé: 'medical-expenses',
  sante: 'medical-expenses',
  cadeaux: 'gifts',
  cadeau: 'gifts',
}

/** Settlement markers: Tricount BALANCE rows and transfer-like titles. */
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
]

export function tricountCategoryToId(
  category: string,
  customCategory: string,
  transactionType: string,
): CategoryId {
  if (transactionType.trim().toUpperCase() === 'BALANCE') return 'settlement'
  const custom = customCategory.trim()
  if (custom !== '') {
    const key = custom.toLowerCase()
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key]!
    return 'general'
  }
  const trimmed = category.trim()
  if (trimmed === '') return 'general'
  const key = trimmed.toLowerCase()
  if (key === 'uncategorized' || key === 'other') return 'general'
  return CATEGORY_MAP[key] ?? 'general'
}

/** Title-keyword fallback for settlement detection on GDPR rows. */
export function tricountLooksLikeSettlementTitle(title: string): boolean {
  const lower = title.toLowerCase()
  return SETTLEMENT_TITLES.some((marker) => lower.includes(marker))
}
