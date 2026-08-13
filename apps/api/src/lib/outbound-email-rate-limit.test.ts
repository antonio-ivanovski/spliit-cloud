import { describe, expect, it, vi } from 'vitest'

import { allowUserGeneratedEmail } from './outbound-email-rate-limit'

describe('user-generated email limits', () => {
  it('suppresses repeated delivery to one recipient after the daily quota', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const options = {
      senderAccountId: 'sender-recipient-limit-test',
      recipientEmail: 'recipient-limit@example.test',
      policy: 'test-email',
    }

    for (let count = 0; count < 10; count += 1) {
      expect(allowUserGeneratedEmail(options)).toBe(true)
    }
    expect(allowUserGeneratedEmail(options)).toBe(false)
  })

  it('does not consume recipient quota after the sender is over quota', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exhaustedSender = 'sender-dual-hit-test'

    for (let count = 0; count < 200; count += 1) {
      expect(
        allowUserGeneratedEmail({
          senderAccountId: exhaustedSender,
          recipientEmail: `recipient-${count}@example.test`,
          policy: 'test-email',
        }),
      ).toBe(true)
    }

    for (let count = 0; count < 10; count += 1) {
      expect(
        allowUserGeneratedEmail({
          senderAccountId: exhaustedSender,
          recipientEmail: 'protected-recipient@example.test',
          policy: 'test-email',
        }),
      ).toBe(false)
    }

    for (let count = 0; count < 10; count += 1) {
      expect(
        allowUserGeneratedEmail({
          senderAccountId: 'fresh-sender-dual-hit-test',
          recipientEmail: 'protected-recipient@example.test',
          policy: 'test-email',
        }),
      ).toBe(true)
    }
  })
})
