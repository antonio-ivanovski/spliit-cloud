import { describe, expect, it } from 'vitest'

import { createOpenAiAppsChallengeResponse } from './domain-verification'

describe('OpenAI Apps domain verification', () => {
  it('returns the configured challenge token', async () => {
    const response = createOpenAiAppsChallengeResponse()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    await expect(response.text()).resolves.toBe(
      'DSr2UeKW2yP07bHAMUvyidOy8MV3q0i9xe_C2GTZ3lY',
    )
  })
})
