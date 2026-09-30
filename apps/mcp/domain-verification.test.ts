import { describe, expect, it } from 'vitest'

import {
  createOpenAiAppsChallengeResponse,
  DEFAULT_OPENAI_APPS_CHALLENGE,
} from './domain-verification'

describe('OpenAI Apps domain verification', () => {
  it('returns the configured challenge token', async () => {
    const response = createOpenAiAppsChallengeResponse()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    await expect(response.text()).resolves.toBe(DEFAULT_OPENAI_APPS_CHALLENGE)
  })

  it('serves a fresh portal token verbatim when configured', async () => {
    const response = createOpenAiAppsChallengeResponse('  fresh-token  ')

    await expect(response.text()).resolves.toBe('fresh-token')
  })
})
