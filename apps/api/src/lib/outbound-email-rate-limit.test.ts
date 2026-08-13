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
})
