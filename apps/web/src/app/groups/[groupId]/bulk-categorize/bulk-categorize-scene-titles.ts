import type {
  SortingCategory,
  SortingTitle,
} from './bulk-categorize-scene-sequence'

const PRESET_TITLES: ReadonlyArray<{
  key: string
  category: SortingCategory
}> = [
  { key: 'BulkCategorize.receiptTitles.freshMarket', category: 'groceries' },
  { key: 'BulkCategorize.receiptTitles.greenGrocer', category: 'groceries' },
  { key: 'BulkCategorize.receiptTitles.fruitStand', category: 'groceries' },
  { key: 'BulkCategorize.receiptTitles.organicMarket', category: 'groceries' },
  { key: 'BulkCategorize.receiptTitles.bakeryRun', category: 'groceries' },
  { key: 'BulkCategorize.receiptTitles.cornerBistro', category: 'dining' },
  { key: 'BulkCategorize.receiptTitles.noodleHouse', category: 'dining' },
  { key: 'BulkCategorize.receiptTitles.cafeLunch', category: 'dining' },
  { key: 'BulkCategorize.receiptTitles.sushiBar', category: 'dining' },
  { key: 'BulkCategorize.receiptTitles.pizzaNight', category: 'dining' },
  { key: 'BulkCategorize.receiptTitles.flightTicket', category: 'plane' },
  { key: 'BulkCategorize.receiptTitles.airlineBaggage', category: 'plane' },
  { key: 'BulkCategorize.receiptTitles.boardingPass', category: 'plane' },
  { key: 'BulkCategorize.receiptTitles.airportLounge', category: 'plane' },
  { key: 'BulkCategorize.receiptTitles.extraLegroom', category: 'plane' },
  { key: 'BulkCategorize.receiptTitles.homeSupplies', category: 'household' },
  { key: 'BulkCategorize.receiptTitles.hardwareShop', category: 'household' },
  { key: 'BulkCategorize.receiptTitles.cleaningGoods', category: 'household' },
  {
    key: 'BulkCategorize.receiptTitles.laundryDetergent',
    category: 'household',
  },
  { key: 'BulkCategorize.receiptTitles.storageBoxes', category: 'household' },
  { key: 'BulkCategorize.receiptTitles.cinemaTickets', category: 'movies' },
  { key: 'BulkCategorize.receiptTitles.movieNight', category: 'movies' },
  { key: 'BulkCategorize.receiptTitles.filmFestival', category: 'movies' },
  { key: 'BulkCategorize.receiptTitles.popcornCombo', category: 'movies' },
  { key: 'BulkCategorize.receiptTitles.streamingRental', category: 'movies' },
]

export function sortingPresetTitles(
  translate: (key: string) => string,
): SortingTitle[] {
  return PRESET_TITLES.map(({ key, category }) => ({
    title: translate(key),
    category,
  }))
}
