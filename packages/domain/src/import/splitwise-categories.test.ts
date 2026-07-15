import { describe, expect, it } from 'vitest'

import { splitwiseCategoryToId } from './splitwise-categories'

describe('splitwiseCategoryToId for the compact category taxonomy', () => {
  it.each(['Activities', 'Events', 'Attractions', 'Parties'])(
    'maps %s to Events and Activities',
    (category) => {
      expect(splitwiseCategoryToId(category)).toBe('events-and-activities')
    },
  )

  it.each(['Subscriptions', 'Streaming', 'Software', 'Cloud Storage'])(
    'maps %s to Digital Subscriptions',
    (category) => {
      expect(splitwiseCategoryToId(category)).toBe('digital-subscriptions')
    },
  )

  it.each(['Membership', 'Memberships', 'Gym', 'Fitness'])(
    'maps %s to Memberships',
    (category) => {
      expect(splitwiseCategoryToId(category)).toBe('memberships')
    },
  )

  it.each(['Personal Care', 'Wellness', 'Beauty'])(
    'maps %s to Personal Care and Wellness',
    (category) => {
      expect(splitwiseCategoryToId(category)).toBe('personal-care-and-wellness')
    },
  )

  it('preserves existing categories instead of broadening them', () => {
    expect(splitwiseCategoryToId('Entertainment - Movies')).toBe('movies')
    expect(splitwiseCategoryToId('Utilities - TV/Phone/Internet')).toBe(
      'tv-phone-internet',
    )
    expect(splitwiseCategoryToId('Life - Medical Expenses')).toBe(
      'medical-expenses',
    )
  })
})
