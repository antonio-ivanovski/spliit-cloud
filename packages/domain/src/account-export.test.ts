import { describe, expect, it } from 'vitest'

import {
  accountExportGroupSectionFor,
  accountExportSelectionIncludesGroup,
  resolveAccountExportGroupIds,
} from './account-export'
import {
  accountExportSelectionSchema,
  defaultAccountExportSelection,
} from './export-manifest'

describe('account export selection', () => {
  it('uses the same mutually-exclusive group buckets as the account UI', () => {
    expect(
      accountExportGroupSectionFor({
        groupType: 'GROUP',
        archived: false,
        starred: false,
        hidden: false,
      }),
    ).toBe('GROUPS')
    expect(
      accountExportGroupSectionFor({
        groupType: 'FRIEND',
        archived: false,
        starred: false,
        hidden: false,
      }),
    ).toBe('FRIENDS')
    expect(
      accountExportGroupSectionFor({
        groupType: 'GROUP',
        archived: true,
        starred: false,
        hidden: false,
      }),
    ).toBe('ARCHIVED')
    expect(
      accountExportGroupSectionFor({
        groupType: 'GROUP',
        archived: false,
        starred: true,
        hidden: false,
      }),
    ).toBe('STARRED')
    expect(
      accountExportGroupSectionFor({
        groupType: 'GROUP',
        archived: false,
        starred: true,
        hidden: true,
      }),
    ).toBe('HIDDEN')
  })

  it('applies explicit group overrides over section defaults', () => {
    const selection = accountExportSelectionSchema.parse({
      ...defaultAccountExportSelection,
      sections: { ...defaultAccountExportSelection.sections, GROUPS: false },
      groupOverrides: [{ groupSourceId: 'grp-2', included: true }],
    })
    const groups = [
      {
        id: 'grp-2',
        groupType: 'GROUP' as const,
        archived: false,
        starred: false,
        hidden: false,
      },
      {
        id: 'grp-1',
        groupType: 'GROUP' as const,
        archived: false,
        starred: false,
        hidden: false,
      },
    ]

    expect(accountExportSelectionIncludesGroup(groups[0], selection)).toBe(true)
    expect(accountExportSelectionIncludesGroup(groups[1], selection)).toBe(
      false,
    )
    expect(resolveAccountExportGroupIds(groups, selection)).toEqual(['grp-2'])
  })

  it('rejects duplicate overrides and returns stable source-id ordering', () => {
    expect(() =>
      accountExportSelectionSchema.parse({
        ...defaultAccountExportSelection,
        groupOverrides: [
          { groupSourceId: 'grp-1', included: true },
          { groupSourceId: 'grp-1', included: false },
        ],
      }),
    ).toThrow()

    const selection = accountExportSelectionSchema.parse(
      defaultAccountExportSelection,
    )
    expect(
      resolveAccountExportGroupIds(
        [
          {
            id: 'grp-z',
            groupType: 'GROUP',
            archived: false,
            starred: false,
            hidden: false,
          },
          {
            id: 'grp-a',
            groupType: 'GROUP',
            archived: false,
            starred: false,
            hidden: false,
          },
        ],
        selection,
      ),
    ).toEqual(['grp-a', 'grp-z'])
  })
})
