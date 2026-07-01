import type { CategoryId } from '../categories'

// "Other" intentionally falls back to its parent group: in Splitwise, "Other"
// is always rendered as a sub-item under a parent category (e.g. "Home - Other"),
// not as a top-level category of its own.
const CATEGORY_MAP: Record<string, CategoryId> = {
  general: 'general',
  payment: 'payment',
  entertainment: 'entertainment',
  games: 'games',
  movies: 'movies',
  music: 'music',
  sports: 'sports',
  'food and drink': 'food-and-drink',
  'dining out': 'dining-out',
  groceries: 'groceries',
  liquor: 'liquor',
  home: 'home',
  electronics: 'electronics',
  furniture: 'furniture',
  'household supplies': 'household-supplies',
  maintenance: 'maintenance',
  mortgage: 'mortgage',
  pets: 'pets',
  rent: 'rent',
  services: 'services',
  childcare: 'childcare',
  clothing: 'clothing',
  education: 'education',
  gifts: 'gifts',
  insurance: 'insurance',
  'medical expenses': 'medical-expenses',
  taxes: 'taxes',
  transportation: 'transportation',
  bicycle: 'bicycle',
  'bus/train': 'bus-train',
  car: 'car',
  'gas/fuel': 'gas-fuel',
  hotel: 'hotel',
  parking: 'parking',
  plane: 'plane',
  taxi: 'taxi',
  utilities: 'utilities',
  cleaning: 'cleaning',
  electricity: 'electricity',
  'heat/gas': 'heat-gas',
  trash: 'trash',
  'tv/phone/internet': 'tv-phone-internet',
  water: 'water',
}

export function splitwiseCategoryToId(name: string): CategoryId {
  const trimmed = name.trim()
  if (trimmed === '') return 'general'
  const key = trimmed.toLowerCase()
  if (key.includes(' - ')) {
    const [left, right] = key.split(' - ')
    if (right === 'other') {
      return CATEGORY_MAP[left] ?? 'general'
    }
    return CATEGORY_MAP[right] ?? CATEGORY_MAP[left] ?? 'general'
  }
  return CATEGORY_MAP[key] ?? 'general'
}
