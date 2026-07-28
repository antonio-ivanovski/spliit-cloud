import { describe, expect, it } from 'vitest'

import {
  renderExpenseActivityEmail,
  renderFriendLedgerEmail,
  renderGroupActivityEmail,
  renderInvitationEmail,
  renderMagicLinkEmail,
  renderPasswordRecoveryEmail,
  renderVerificationEmail,
} from './index'

describe('email templates', () => {
  describe('renderPasswordRecoveryEmail', () => {
    it('renders the credentials copy in both email bodies', async () => {
      const r = await renderPasswordRecoveryEmail({
        resetUrl: 'https://spliit.test/reset?token=abc',
        methodLabels: ['email and password'],
      })
      expect(r.subject).toBe('Reset your Spliit Cloud password')
      expect(r.text).toContain(
        'Click the link below to reset your Spliit Cloud password.',
      )
      expect(r.text).toContain('https://spliit.test/reset?token=abc')
      expect(r.text).toContain(
        'If you did not request a password reset, you can safely ignore this email.',
      )
      expect(r.html).toContain('Reset your Spliit Cloud password')
      expect(r.html).toContain('https://spliit.test/reset?token=abc')
    })

    it('lists linked sign-in methods for credential users with multiple identities', async () => {
      const r = await renderPasswordRecoveryEmail({
        resetUrl: 'https://spliit.test/reset?token=abc',
        methodLabels: ['email and password', 'Google', 'email sign-in link'],
      })
      expect(r.text).toContain(
        'This account can also sign in with: Google, email sign-in link.',
      )
      expect(r.html).toContain('Google, email sign-in link')
    })

    it('routes social-only accounts to the sign-in guidance body', async () => {
      const r = await renderPasswordRecoveryEmail({
        resetUrl: 'https://spliit.test/reset?token=abc',
        methodLabels: ['Google', 'email sign-in link'],
      })
      expect(r.subject).toBe('Sign in to Spliit Cloud')
      expect(r.text).toContain(
        'Use one of these sign-in methods instead: Google, email sign-in link.',
      )
      expect(r.html).toContain('Sign in to Spliit Cloud')
    })
  })

  describe('renderVerificationEmail', () => {
    it('renders the verification body in both email formats', async () => {
      const r = await renderVerificationEmail({
        verificationUrl: 'https://spliit.test/verify?token=abc',
      })
      expect(r.subject).toBe('Verify your Spliit Cloud account')
      expect(r.text).toContain(
        'Click the link below to verify your email address and sign in to Spliit Cloud.',
      )
      expect(r.text).toContain('If you did not create a Spliit Cloud account')
      expect(r.html).toContain('Verify your Spliit Cloud account')
    })
  })

  describe('renderMagicLinkEmail', () => {
    it('renders the sign-in body in both email formats', async () => {
      const r = await renderMagicLinkEmail({
        signInUrl: 'https://spliit.test/auth/verify?token=abc',
      })
      expect(r.subject).toBe('Your Spliit Cloud sign-in link')
      expect(r.text).toContain(
        'Click the link below to sign in to Spliit Cloud.',
      )
      expect(r.text).toContain(
        'If you did not request this email, you can safely ignore it.',
      )
      expect(r.html).toContain('Your Spliit Cloud sign-in link')
    })
  })

  describe('renderInvitationEmail', () => {
    it('produces the existing-user body and CTA label', async () => {
      const r = await renderInvitationEmail({
        invitationId: 'inv-new',
        groupId: 'grp-1',
        groupName: 'Roadtrip 2026',
        inviterDisplayName: 'Alice',
        inviterRole: 'ADMIN',
        recipientEmail: 'bob@example.com',
        recipientIsExistingUser: true,
      })
      expect(r.subject).toBe(
        'Alice invited you to Roadtrip 2026 on Spliit Cloud',
      )
      expect(r.text.toLowerCase()).toContain('open spliit cloud')
      expect(r.text).toContain('/groups/grp-1')
      expect(r.html).toContain('Open Spliit Cloud')
      expect(r.html).toContain('/groups/grp-1')
    })

    it('produces the new-user body with sign-up CTA', async () => {
      const r = await renderInvitationEmail({
        invitationId: 'inv-new',
        groupId: 'grp-1',
        groupName: 'Roadtrip 2026',
        inviterDisplayName: 'Alice',
        inviterRole: 'ADMIN',
        recipientEmail: 'newuser@example.com',
        recipientIsExistingUser: false,
      })
      expect(r.subject).toBe(
        'Alice invited you to Roadtrip 2026 on Spliit Cloud',
      )
      expect(r.text.toLowerCase()).toContain('create an account')
      expect(r.text).toContain('/?invitation=inv-new')
      expect(r.html).toContain('Create an account')
    })

    it('renders the import context block when sourceProvider is set', async () => {
      const r = await renderInvitationEmail({
        invitationId: 'inv-imp',
        groupId: 'grp-imp',
        groupName: 'Imported Trip',
        inviterDisplayName: 'Alice',
        inviterRole: 'ADMIN',
        recipientEmail: 'friend@example.com',
        recipientIsExistingUser: false,
        temporaryName: 'Friend One',
        sourceProvider: 'SPLIIT',
        sourceGroupName: 'Old Trip',
        expenseCount: 2,
        totalAmount: 3500,
        currencyCode: 'USD',
      })
      expect(r.subject).toBe(
        'Alice invited you to Imported Trip on Spliit Cloud as Friend One',
      )
      expect(r.text).toContain(
        'This invitation is part of an import from a Spliit export.',
      )
      expect(r.text).toContain(
        'The group contains 2 expenses from the import (total USD 35.00)',
      )
      expect(r.html).toContain('Import context')
      expect(r.html).toContain('Source group')
      expect(r.html).toContain('Old Trip')
    })
  })

  describe('renderFriendLedgerEmail', () => {
    it('uses the open-ledger CTA for an existing user', async () => {
      const r = await renderFriendLedgerEmail({
        inviterName: 'Alice',
        isNewUser: false,
      })
      expect(r.subject).toBe(
        'Alice started a friend ledger with you on Spliit Cloud',
      )
      expect(r.text).toContain('Alice started a friend ledger with you')
      expect(r.html).toContain('Open Spliit Cloud')
    })

    it('uses the sign-up CTA for a new user', async () => {
      const r = await renderFriendLedgerEmail({
        inviterName: 'Alice',
        isNewUser: true,
      })
      expect(r.text).toContain('Alice started a friend ledger with you')
      expect(r.html).toContain('Create a free account')
    })
  })

  describe('renderGroupActivityEmail', () => {
    it('renders generic activity details in both email bodies', async () => {
      const r = await renderGroupActivityEmail({
        subject: '[Spliit Cloud] Group details were updated in Roadtrip 2026',
        text: 'Group details were updated in Roadtrip 2026 by Alice.\n\nView the group here:\nhttps://spliit.test/groups/grp-1',
        brandBaseUrl: 'https://spliit.test',
        groupDisplayName: 'Roadtrip 2026',
        actorName: 'Alice',
        activityLabel: 'Group details were updated',
        groupUrl: 'https://spliit.test/groups/grp-1',
        unsubscribeUrl:
          'https://spliit.test/email/unsubscribe?token=test-token',
      })
      expect(r.text).toContain('View the group here')
      expect(r.html).toContain('Group details were updated')
      expect(r.html).toContain('View group')
      expect(r.html).toContain('https://spliit.test/groups/grp-1')
      expect(r.html).toContain('Unsubscribe from these email notifications')
      expect(r.html).toContain(
        'https://spliit.test/email/unsubscribe?token=test-token',
      )
    })
  })

  describe('renderExpenseActivityEmail', () => {
    it('renders an expense comment with excerpt and direct link', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense_comment',
        subject: '[Spliit Cloud] Alice commented on "Dinner" in Test Group',
        text: 'Alice commented on "Dinner" in Test Group.\n\n"Looks good"',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        excerpt: 'Looks good',
        expenseUrl: 'https://spliit.app/groups/grp-1/expenses/exp-1',
      })
      expect(r.subject).toContain('commented on')
      expect(r.text).toContain('Looks good')
      expect(r.html).toContain('View expense')
      expect(r.html).toContain('/groups/grp-1/expenses/exp-1')
    })

    it('produces expense-created email with subject and styled html', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense',
        subject:
          '[Spliit Cloud] Expense "Dinner" was added by Alice to Test Group',
        text:
          'Expense "Dinner" (EUR 45.00) was added by Alice to Test Group on 2026-07-02.\n\n' +
          'View it here:\nhttps://spliit.app/groups/grp-1/expenses/exp-1',
        eventType: 'EXPENSE_CREATED',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        amountStr: 'EUR 45.00',
        date: '2026-07-02',
        expenseUrl: 'https://spliit.app/groups/grp-1/expenses/exp-1',
      })
      expect(r.subject).toContain('Expense "Dinner" was added by Alice')
      expect(r.text).toContain('EUR 45.00')
      expect(r.text).toContain('2026-07-02')
      expect(r.html).toContain('Dinner')
      expect(r.html).toContain('EUR 45.00')
      expect(r.html).toContain('View expense')
    })

    it('produces expense-updated email with changed fields', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense',
        subject:
          '[Spliit Cloud] Expense "Dinner" was updated by Alice in Test Group',
        text: 'Expense "Dinner" was updated by Alice in Test Group.\nAmount: EUR 50.00\nDate: 2026-07-02\nChanged: amount, title',
        eventType: 'EXPENSE_UPDATED',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        amountStr: 'EUR 50.00',
        date: '2026-07-02',
        changedFields: ['amount', 'title'],
        expenseUrl: 'https://spliit.app/groups/grp-1/expenses/exp-1',
      })
      expect(r.html).toContain('amount, title')
    })

    it('produces expense-deleted email pointing to the group', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense',
        subject:
          '[Spliit Cloud] Expense "Dinner" was removed by Alice from Test Group',
        text: 'Expense "Dinner" was removed by Alice from Test Group.',
        eventType: 'EXPENSE_DELETED',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        amountStr: 'EUR 45.00',
        date: '2026-07-02',
        expenseUrl: 'https://spliit.app/groups/grp-1',
      })
      expect(r.html).toContain('Dinner')
      expect(r.html).toContain('Open group')
    })

    it('produces import-summary email with the count and total', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'import_summary',
        subject: '[Spliit Cloud] 25 expenses imported in Test Group',
        text: 'Alice imported 25 expenses from Splitwise in Test Group (total EUR 1234.50).',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        count: 25,
        sourceProvider: 'Splitwise',
        totalStr: 'EUR 1234.50',
        groupUrl: 'https://spliit.app/groups/grp-1',
      })
      expect(r.subject).toContain('25 expenses imported')
      expect(r.text).toContain('Alice imported 25 expenses from Splitwise')
      expect(r.html).toContain('Alice')
      expect(r.html).toContain('25 expenses')
      expect(r.html).toContain('Splitwise')
      expect(r.html).toContain('EUR 1234.50')
    })

    it('renders recurrence line on RECURRING_EXPENSE_STOPPED expense email', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense',
        subject: '[Spliit Cloud] Recurring expense stopped in Test Group',
        text: 'Alice stopped the recurring expense "Dinner" (Every 2 months, 12 total) in Test Group.',
        eventType: 'RECURRING_EXPENSE_STOPPED',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        amountStr: null,
        date: null,
        expenseUrl: 'https://spliit.app/groups/grp-1',
        recurrence: 'Every 2 months, 12 total',
      })
      expect(r.html).toContain('Repeats:')
      expect(r.html).toContain('Every 2 months, 12 total')
      expect(r.html).toContain('Alice stopped recurring')
    })

    it('renders recurrence line on RECURRING_EXPENSE_CREATED expense email', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'expense',
        subject:
          '[Spliit Cloud] Recurring expense "Dinner" was created by Alice in Test Group',
        text: 'Recurring expense "Dinner" (EUR 45.00) was created by Alice in Test Group on 2026-07-02.',
        eventType: 'RECURRING_EXPENSE_CREATED',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Dinner',
        amountStr: 'EUR 45.00',
        date: '2026-07-02',
        expenseUrl: 'https://spliit.app/groups/grp-1/expenses/exp-1',
        recurrence: 'Every month',
      })
      expect(r.html).toContain('Repeats:')
      expect(r.html).toContain('Every month')
    })

    it('renders recurrence line on recurring_expense_summary email', async () => {
      const r = await renderExpenseActivityEmail({
        kind: 'recurring_expense_summary',
        subject: '[Spliit Cloud] 3 recurring expenses caught up in Test Group',
        text: 'Alice created 3 recurring expenses "Lunch" (Every 2 months, 12 total) in Test Group from 2026-07-01 to 2026-07-03.',
        brandBaseUrl: 'https://spliit.app',
        groupDisplayName: 'Test Group',
        actorName: 'Alice',
        title: 'Lunch',
        count: 3,
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        groupUrl: 'https://spliit.app/groups/grp-1',
        operation: 'create',
        recurrence: 'Every 2 months, 12 total',
      })
      expect(r.html).toContain('Every 2 months, 12 total')
      expect(r.html).toContain('Open group')
    })
  })
})
