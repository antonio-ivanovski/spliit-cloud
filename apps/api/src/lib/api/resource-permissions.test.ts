import { describe, expect, it } from 'vitest'

import {
  canCreateInvitationWithRole,
  canManageOwnedResource,
  canRevokeInvitation,
  expenseOwnerAccountId,
  expensePermissions,
} from './resource-permissions'

describe('owned resource permissions', () => {
  it('lets admins manage any resource, including legacy null ownership', () => {
    expect(
      canManageOwnedResource({
        role: 'ADMIN',
        accountId: 'admin',
        createdByAccountId: null,
      }),
    ).toBe(true)
  })

  it('limits members to resources they created', () => {
    expect(
      canManageOwnedResource({
        role: 'MEMBER',
        accountId: 'member',
        createdByAccountId: 'member',
      }),
    ).toBe(true)
    expect(
      canManageOwnedResource({
        role: 'MEMBER',
        accountId: 'member',
        createdByAccountId: 'other',
      }),
    ).toBe(false)
    expect(
      canManageOwnedResource({
        role: 'MEMBER',
        accountId: 'member',
        createdByAccountId: null,
      }),
    ).toBe(false)
  })

  it('uses the immutable series creator for recurring expenses', () => {
    expect(
      expenseOwnerAccountId({
        createdByAccountId: 'admin-editor',
        recurringSeries: { creatorAccountId: 'member-creator' },
      }),
    ).toBe('member-creator')
    expect(
      expensePermissions({
        role: 'MEMBER',
        accountId: 'member-creator',
        createdByAccountId: 'admin-editor',
        recurringSeries: { creatorAccountId: 'member-creator' },
        archived: false,
      }),
    ).toEqual({
      canEdit: true,
      canDelete: true,
      canManageRecurrence: true,
    })
  })

  it('keeps archived resources read-only', () => {
    expect(
      expensePermissions({
        role: 'ADMIN',
        accountId: 'admin',
        createdByAccountId: 'member',
        archived: true,
      }),
    ).toEqual({
      canEdit: false,
      canDelete: false,
      canManageRecurrence: false,
    })
  })
})

describe('invitation permissions', () => {
  it('limits member-created invitations to the MEMBER role', () => {
    expect(canCreateInvitationWithRole('MEMBER', 'MEMBER')).toBe(true)
    expect(canCreateInvitationWithRole('MEMBER', 'ADMIN')).toBe(false)
    expect(canCreateInvitationWithRole('ADMIN', 'ADMIN')).toBe(true)
  })

  it('lets members revoke only their own unused invitations', () => {
    expect(
      canRevokeInvitation({
        role: 'MEMBER',
        accountId: 'member',
        invitedById: 'member',
        isUnused: true,
      }),
    ).toBe(true)
    expect(
      canRevokeInvitation({
        role: 'MEMBER',
        accountId: 'member',
        invitedById: 'member',
        isUnused: false,
      }),
    ).toBe(false)
    expect(
      canRevokeInvitation({
        role: 'ADMIN',
        accountId: 'admin',
        invitedById: 'member',
        isUnused: false,
      }),
    ).toBe(true)
  })
})
