import {
  DEFAULT_CATEGORIES,
  type Category,
  type CategoryId,
} from './categories'

export type CategoryAIDescription = {
  /** What belongs in this category (one generic line). */
  what: string
  /** What looks similar but belongs in another category. */
  notFor: string
}

/**
 * Generic per-option guidance for the AI categorizers (System One criteria and
 * the LLM category list share the same formatter). `what` states what the
 * category covers; `notFor` separates it from its closest neighbors, naming the
 * category id to prefer instead. English only, matching the taxonomy source
 * strings; the request locale travels separately as a hint.
 */
export const CATEGORY_AI_DESCRIPTIONS: Record<
  CategoryId,
  CategoryAIDescription
> = {
  uncategorized: {
    what: 'miscellaneous spending that fits no other group',
    notFor: 'anything matching a specific group — this is the last resort',
  },
  general: {
    what: 'default fallback when no category fits at all',
    notFor: 'any expense that matches another category, even loosely',
  },
  payment: {
    what: 'moving money without buying anything: transfers, bank fees, service charges',
    notFor:
      'purchases of goods or services — categorize those by what was bought',
  },
  income: {
    what: 'money received: salary, refunds, reimbursements, payouts',
    notFor: 'money spent — income is the only inflow category',
  },
  settlement: {
    what: 'internal balance settlements between group members (never suggested for real expenses)',
    notFor: 'everything — this category is excluded from suggestions',
  },
  entertainment: {
    what: 'leisure and fun spending in general',
    notFor: 'nightlife outings and event tickets (events-and-activities)',
  },
  games: {
    what: 'video games, board games, gaming gear, in-game purchases',
    notFor: 'sports gear and gym costs (sports); cinema and films (movies)',
  },
  movies: {
    what: 'cinema tickets and one-off film rentals or purchases',
    notFor:
      'recurring streaming subscriptions (digital-subscriptions); concerts and music (music)',
  },
  music: {
    what: 'concerts, music streaming, instruments, albums',
    notFor: 'cinema and films (movies); video games (games)',
  },
  sports: {
    what: 'sports gear, gym and training costs, sports event tickets, sportswear',
    notFor: 'club memberships as such (memberships); watching films (movies)',
  },
  'food-and-drink': {
    what: 'any food or drink spending',
    notFor:
      'non-food spending — everything outside eating and drinking belongs elsewhere',
  },
  'dining-out': {
    what: 'meals and drinks consumed at restaurants, cafes, bars, takeout and delivery orders',
    notFor:
      'supermarket shopping (groceries); alcohol bought in shops (liquor)',
  },
  groceries: {
    what: 'supermarket and grocery shopping for food and drinks at home',
    notFor: 'restaurant meals and takeout (dining-out); alcohol (liquor)',
  },
  liquor: {
    what: 'alcoholic drinks: beer, wine, spirits, in shops or bars',
    notFor:
      'restaurant meals (dining-out); non-alcoholic groceries (groceries)',
  },
  home: {
    what: 'housing and household spending in general',
    notFor: 'monthly utility bills (utilities)',
  },
  electronics: {
    what: 'phones, computers, TVs, gadgets and accessories',
    notFor:
      'phone/internet/TV bills (tv-phone-internet); home repairs (maintenance)',
  },
  furniture: {
    what: 'furniture and furnishings: tables, chairs, beds, lamps, decor',
    notFor: 'electronics (electronics); repairs and upkeep (maintenance)',
  },
  'household-supplies': {
    what: 'consumables for the home: cleaning products, paper goods, light bulbs',
    notFor: 'cleaning services (cleaning); groceries (groceries)',
  },
  maintenance: {
    what: 'home repairs, renovations, tools and repair materials',
    notFor:
      'hired repair work as a service (services); new furniture (furniture)',
  },
  mortgage: {
    what: 'mortgage payments and home loan installments',
    notFor: 'rent and lease payments (rent)',
  },
  gardening: {
    what: 'outdoor garden work: soil, tools, landscaping services',
    notFor: 'indoor plants and pots (plants)',
  },
  pets: {
    what: 'pet food, vet bills, pet supplies and services',
    notFor: 'anything for humans — pets is animals only',
  },
  plants: {
    what: 'indoor plants, pots, seeds and plant care',
    notFor: 'outdoor garden work (gardening)',
  },
  rent: {
    what: 'rent and housing lease payments',
    notFor:
      'mortgage installments (mortgage); hotels and holiday stays (hotel)',
  },
  services: {
    what: 'hired home services: plumbing, electrical work, handymen, movers',
    notFor:
      'monthly utility bills (utilities); repair materials for DIY (maintenance)',
  },
  life: {
    what: 'personal and family life spending in general',
    notFor: 'leisure and fun (entertainment)',
  },
  childcare: {
    what: 'babysitting, daycare, nannies and childminders',
    notFor: 'school fees and courses (education)',
  },
  clothing: {
    what: 'clothes, shoes, accessories and tailoring',
    notFor: 'sports gear and sportswear (sports)',
  },
  education: {
    what: 'tuition, courses, books and school supplies',
    notFor: 'daycare and babysitting (childcare)',
  },
  gifts: {
    what: 'gifts and presents for other people',
    notFor: 'charitable donations (donation)',
  },
  insurance: {
    what: 'insurance premiums of any kind',
    notFor:
      'the insured bills themselves, e.g. doctor visits (medical-expenses)',
  },
  'medical-expenses': {
    what: 'doctors, dentists, pharmacies, hospitals and treatments',
    notFor:
      'insurance premiums (insurance); spa and wellness (personal-care-and-wellness)',
  },
  taxes: {
    what: 'tax payments and government fees',
    notFor: 'insurance premiums (insurance)',
  },
  donation: {
    what: 'charitable donations and fundraising',
    notFor: 'personal gifts to people you know (gifts)',
  },
  transportation: {
    what: 'getting around, in general',
    notFor: 'holiday accommodation (hotel)',
  },
  bicycle: {
    what: 'bike purchases, repairs, rentals and bike sharing',
    notFor: 'car costs (car); public transit tickets (bus-train)',
  },
  'bus-train': {
    what: 'public transit tickets and passes: bus, tram, metro, train',
    notFor: 'flights (plane); taxis and ride-hailing (taxi)',
  },
  car: {
    what: 'car purchase, repairs, servicing and car sharing, excluding fuel and tolls',
    notFor: 'fuel (gas-fuel); tolls (tolls); parking fees (parking)',
  },
  'gas-fuel': {
    what: 'fuel for vehicles: gas, diesel, EV charging on the road',
    notFor: 'home heating and gas bills (heat-gas); car repairs (car)',
  },
  hotel: {
    what: 'hotels, hostels and holiday accommodation',
    notFor: 'rent and housing (rent); flights (plane)',
  },
  parking: {
    what: 'parking fees, garages and meters',
    notFor: 'road tolls (tolls)',
  },
  plane: {
    what: 'flights and air travel tickets',
    notFor: 'trains and buses (bus-train); hotels (hotel)',
  },
  taxi: {
    what: 'taxis and ride-hailing such as Uber, Lyft or Bolt',
    notFor: 'public transit (bus-train); your own car costs (car)',
  },
  tolls: {
    what: 'road tolls and congestion charges',
    notFor: 'parking fees (parking); fuel (gas-fuel)',
  },
  utilities: {
    what: 'recurring home utility bills in general',
    notFor:
      'phone/internet/TV plans (tv-phone-internet); home repairs (maintenance)',
  },
  cleaning: {
    what: 'cleaning services, laundry and dry cleaning',
    notFor: 'cleaning products bought in shops (household-supplies)',
  },
  electricity: {
    what: 'electricity bills',
    notFor: 'heating and gas bills (heat-gas)',
  },
  'heat-gas': {
    what: 'home heating and gas bills',
    notFor: 'vehicle fuel (gas-fuel); electricity bills (electricity)',
  },
  trash: {
    what: 'waste disposal and garbage collection fees',
    notFor: 'water bills (water); cleaning services (cleaning)',
  },
  'tv-phone-internet': {
    what: 'TV, phone and internet bills and plans',
    notFor:
      'content subscriptions such as streaming platforms (digital-subscriptions); devices (electronics)',
  },
  water: {
    what: 'water bills',
    notFor: 'other utility bills such as electricity or gas (utilities)',
  },
  'social-and-activities': {
    what: 'social life and group activities in general',
    notFor: 'leisure consumption such as films and music (entertainment)',
  },
  'events-and-activities': {
    what: 'tickets and fees for events, exhibitions, nightlife and group outings',
    notFor: 'cinema, concerts and sports events (movies, music, sports)',
  },
  'subscriptions-and-memberships': {
    what: 'recurring subscriptions and memberships in general',
    notFor: 'utility and phone plans (utilities, tv-phone-internet)',
  },
  'digital-subscriptions': {
    what: 'recurring digital subscriptions: streaming platforms, apps, cloud storage, software',
    notFor:
      'phone/internet plans (tv-phone-internet); one-off film rentals (movies)',
  },
  memberships: {
    what: 'club, association and organization memberships',
    notFor:
      'sports activities and gear (sports); digital app subscriptions (digital-subscriptions)',
  },
  'personal-care-and-wellness': {
    what: 'grooming and wellness: hairdresser, cosmetics, massage, spa, fitness classes',
    notFor: 'medical treatment (medical-expenses); sports gear (sports)',
  },
}

const parentById = new Map(
  DEFAULT_CATEGORIES.map((category) => [category.id, category]),
)

/**
 * Full AI-facing description for one category: taxonomy path plus the generic
 * `what`/`notFor` guidance plus a hint of the parent category. The parent hint
 * is derived from the taxonomy (never hand-written): children point at their
 * parent for generic spending, parents point at their children for specifics.
 * `general` gets no parent hint — it is the instructed no-match target and must
 * not leak mass to `uncategorized`.
 */
export function describeCategoryForAI(category: Category): string {
  const { what, notFor } = CATEGORY_AI_DESCRIPTIONS[category.id]
  const parent = category.parentId
    ? parentById.get(category.parentId)
    : undefined
  let parentHint = ''
  if (parent && category.id !== 'general') {
    parentHint = ` Part of "${parent.grouping}". If the expense is ${parent.grouping} spending in general rather than specifically the above, choose "${parent.id}".`
  } else if (!parent) {
    const hasChildren = DEFAULT_CATEGORIES.some(
      (child) => child.parentId === category.id,
    )
    if (hasChildren) {
      parentHint = ` Generic ${category.grouping} spending; prefer a more specific child category when one fits.`
    }
  }
  return `"${category.grouping}/${category.name}" (ID: ${category.id}). Covers: ${what}. Not: ${notFor}.${parentHint}`
}
