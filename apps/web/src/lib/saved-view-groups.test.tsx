import { afterEach, describe, expect, it } from 'vitest'

import {
  DEVICE_SAVED_VIEWS_KEY,
  clearDeviceSavedViews,
  isDeviceGroupSaved,
  readDeviceSavedViews,
  removeDeviceView,
  saveDeviceView,
  touchDeviceView,
} from '@/lib/saved-view-groups'

const sample = {
  groupId: 'group-1',
  viewKey: 'secret',
  name: 'Trip',
  memberCount: 3,
  lastOpenedAt: '2026-08-01T00:00:00.000Z',
}

describe('device saved views', () => {
  afterEach(() => {
    clearDeviceSavedViews()
  })

  it('saves, reads, and removes bookmarks', () => {
    saveDeviceView(sample)
    expect(readDeviceSavedViews()).toEqual([sample])
    expect(isDeviceGroupSaved('group-1')).toBe(true)
    expect(window.localStorage.getItem(DEVICE_SAVED_VIEWS_KEY)).toContain(
      'group-1',
    )

    removeDeviceView('group-1')
    expect(readDeviceSavedViews()).toEqual([])
    expect(window.localStorage.getItem(DEVICE_SAVED_VIEWS_KEY)).toBeNull()
  })

  it('touches an existing bookmark and ignores unknown groups', () => {
    saveDeviceView(sample)
    expect(
      touchDeviceView({
        groupId: 'group-1',
        viewKey: 'rotated',
        name: 'Trip 2',
        memberCount: 4,
        lastOpenedAt: '2026-08-02T00:00:00.000Z',
      }),
    ).toBe(true)
    expect(readDeviceSavedViews()[0]).toMatchObject({
      viewKey: 'rotated',
      name: 'Trip 2',
      memberCount: 4,
      lastOpenedAt: '2026-08-02T00:00:00.000Z',
    })
    expect(readDeviceSavedViews()[0]?.groupId).toBe('group-1')
    expect(
      touchDeviceView({
        groupId: 'missing',
        viewKey: 'x',
        name: 'Nope',
        memberCount: 0,
      }),
    ).toBe(false)
  })

  it('ignores malformed localStorage payloads', () => {
    window.localStorage.setItem(DEVICE_SAVED_VIEWS_KEY, '{not json')
    expect(readDeviceSavedViews()).toEqual([])
    window.localStorage.setItem(DEVICE_SAVED_VIEWS_KEY, '[{"groupId":1}]')
    expect(readDeviceSavedViews()).toEqual([])
  })

  it('orders bookmarks by lastOpenedAt after a touch', () => {
    saveDeviceView({
      ...sample,
      groupId: 'older',
      lastOpenedAt: '2026-08-03T00:00:00.000Z',
    })
    saveDeviceView({
      ...sample,
      groupId: 'newer',
      lastOpenedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(readDeviceSavedViews().map((item) => item.groupId)).toEqual([
      'older',
      'newer',
    ])
    touchDeviceView({
      groupId: 'newer',
      viewKey: 'secret',
      name: 'Trip',
      memberCount: 3,
      lastOpenedAt: '2026-08-04T00:00:00.000Z',
    })
    expect(readDeviceSavedViews().map((item) => item.groupId)).toEqual([
      'newer',
      'older',
    ])
  })
})
