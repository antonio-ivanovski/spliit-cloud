import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { beforeEach, describe, expect, it } from 'vitest'
import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'
import { GroupEmailActivityNotificationDispatcher } from './group-email-dispatcher'
import type { ActivityNotificationEvent } from './types'

function buildEvent(
  overrides: Partial<ActivityNotificationEvent> = {},
): ActivityNotificationEvent {
  return {
    activityId: 'activity-1',
    type: 'INVITATION_CREATED',
    groupId: 'group-1',
    actor: { type: 'ACCOUNT', id: 'account-alice' },
    subject: { type: 'INVITATION', id: 'invitation-1' },
    data: {
      kind: 'invitation',
      invitationType: 'EMAIL',
      displayLabel: 'Bob',
      role: 'ADMIN',
    },
    occurredAt: new Date('2026-07-02T12:00:00Z'),
    ...overrides,
  }
}

const dispatcher = new GroupEmailActivityNotificationDispatcher()

beforeEach(() => {
  prismaMock.account.findUnique.mockResolvedValue({
    email: 'bob@example.com',
    name: 'Alice',
  } as never)
  prismaMock.group.findUnique.mockResolvedValue({
    name: 'Roadtrip 2026',
  } as never)
  prismaMock.groupInvitation.findUnique.mockResolvedValue({
    role: 'ADMIN',
    temporaryName: null,
  } as never)
  prismaMock.groupMember.findFirst.mockResolvedValue({ role: 'ADMIN' } as never)
})

describe('GroupEmailActivityNotificationDispatcher', () => {
  it('uses the branded invitation template for existing users', async () => {
    await dispatcher.dispatch({
      activity: buildEvent(),
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
      recipientAccountId: 'account-bob',
      channels: [NotificationChannel.EMAIL],
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const email = sendEmailMock.mock.calls[0][0]
    expect(email.subject).toContain('invited you to Roadtrip 2026')
    expect(email.text).toContain(
      'Alice (admin) invited you to join "Roadtrip 2026"',
    )
    expect(email.html).toContain('You&#x27;re invited to')
    expect(email.html).toContain('Open Spliit Cloud')
    expect(email.html).toContain('href="http://localhost:3000/groups/group-1"')
  })

  it('always sends an HTML body when unsubscribe metadata is unavailable', async () => {
    await dispatcher.dispatch({
      activity: buildEvent({
        type: 'GROUP_UPDATED',
        subject: null,
        notificationCategory: NotificationCategory.GROUP_INVITE_RECEIVED,
      }),
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
      recipientAccountId: 'account-bob',
      channels: [NotificationChannel.EMAIL],
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0][0].html).toEqual(expect.any(String))
  })

  it('uses the branded group activity template for non-invitation activity', async () => {
    await dispatcher.dispatch({
      activity: buildEvent({
        type: 'GROUP_UPDATED',
        subject: null,
        notificationCategory: NotificationCategory.GROUP_INVITE_RECEIVED,
      }),
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
      recipientAccountId: 'account-bob',
      channels: [NotificationChannel.EMAIL],
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const email = sendEmailMock.mock.calls[0][0]
    expect(email.subject).toBe(
      '[Spliit Cloud] Group details were updated in Roadtrip 2026',
    )
    expect(email.text).toContain('View the group here:')
    expect(email.html).toContain('Group details were updated')
    expect(email.html).toContain('View group')
    expect(email.html).toContain('href="http://localhost:3000/groups/group-1"')
  })

  it('uses the branded friend-ledger template for FRIEND_ADDED', async () => {
    await dispatcher.dispatch({
      activity: buildEvent({
        subject: null,
        notificationCategory: NotificationCategory.FRIEND_ADDED,
      }),
      category: NotificationCategory.FRIEND_ADDED,
      recipientAccountId: 'account-bob',
      channels: [NotificationChannel.EMAIL],
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const email = sendEmailMock.mock.calls[0][0]
    expect(email.subject).toBe(
      'Alice started a friend ledger with you on Spliit Cloud',
    )
    expect(email.text).toContain('Alice started a friend ledger with you')
    expect(email.html).toContain('Alice started a friend ledger with you')
    expect(email.html).toContain('Open Spliit Cloud')
  })
})
