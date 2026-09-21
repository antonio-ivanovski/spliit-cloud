import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAnthropic: vi.fn(),
  createGoogle: vi.fn(),
  createOpenAI: vi.fn(),
  createOpenAICompatible: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mocks.createAnthropic,
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogle: mocks.createGoogle,
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}))

const GO_CHAT_URL = 'https://opencode.ai/zen/go/v1/chat/completions'
const GO_RESPONSES_URL = 'https://opencode.ai/zen/go/v1/responses'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('isOpenCodeGoEndpoint', () => {
  it('matches Go endpoint URLs strictly', async () => {
    const { isOpenCodeGoEndpoint } = await import('./ai')
    expect(isOpenCodeGoEndpoint(GO_CHAT_URL)).toBe(true)
    expect(isOpenCodeGoEndpoint(GO_RESPONSES_URL)).toBe(true)
    expect(isOpenCodeGoEndpoint('https://opencode.ai/zen/go/v1/messages')).toBe(
      true,
    )
  })

  it('rejects non-Go URLs', async () => {
    const { isOpenCodeGoEndpoint } = await import('./ai')
    expect(isOpenCodeGoEndpoint(undefined)).toBe(false)
    expect(isOpenCodeGoEndpoint('')).toBe(false)
    expect(isOpenCodeGoEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isOpenCodeGoEndpoint('https://openrouter.ai/api/v1')).toBe(false)
    expect(isOpenCodeGoEndpoint('https://opencode.ai/zen')).toBe(false)
    expect(isOpenCodeGoEndpoint('https://opencode.ai/')).toBe(false)
    expect(isOpenCodeGoEndpoint('https://example.com/opencode')).toBe(false)
  })
})

describe('getOpenCodeGoHeaders', () => {
  it('returns a stable x-opencode-session header on the Go endpoint', async () => {
    const { env } = await import('./env')
    const { getOpenCodeGoHeaders } = await import('./ai')
    const original = env.AI_BASE_URL
    try {
      env.AI_BASE_URL = GO_CHAT_URL
      const first = getOpenCodeGoHeaders()
      const second = getOpenCodeGoHeaders()
      expect(first['x-opencode-session']).toMatch(UUID_RE)
      expect(second['x-opencode-session']).toBe(first['x-opencode-session'])
    } finally {
      env.AI_BASE_URL = original
    }
  })

  it('returns no headers off the Go endpoint', async () => {
    const { env } = await import('./env')
    const { getOpenCodeGoHeaders } = await import('./ai')
    const original = env.AI_BASE_URL
    try {
      env.AI_BASE_URL = 'https://openrouter.ai/api/v1'
      expect(getOpenCodeGoHeaders()).toEqual({})
      env.AI_BASE_URL = undefined
      expect(getOpenCodeGoHeaders()).toEqual({})
    } finally {
      env.AI_BASE_URL = original
    }
  })
})

describe('getModel OpenCode Go headers', () => {
  let originalProvider: unknown
  let originalBaseUrl: unknown
  let originalApiKey: unknown

  beforeEach(async () => {
    const { env } = await import('./env')
    originalProvider ??= env.AI_PROVIDER
    originalBaseUrl ??= env.AI_BASE_URL
    originalApiKey ??= env.AI_API_KEY
    Object.values(mocks).forEach((fn) => fn.mockReset())
    env.AI_API_KEY = 'test-key'
  })

  afterEach(async () => {
    const { env } = await import('./env')
    env.AI_PROVIDER = originalProvider as never
    env.AI_BASE_URL = originalBaseUrl as never
    env.AI_API_KEY = originalApiKey as never
  })

  async function freshModelWith(
    provider: 'anthropic' | 'google' | 'openai' | 'openai-compatible',
    baseURL: string,
  ) {
    vi.resetModules()
    const { env } = await import('./env')
    const factory =
      provider === 'anthropic'
        ? mocks.createAnthropic
        : provider === 'google'
          ? mocks.createGoogle
          : provider === 'openai'
            ? mocks.createOpenAI
            : mocks.createOpenAICompatible
    factory.mockReset()
    if (provider === 'openai') {
      factory.mockReturnValue({
        responses: (id: string) => ({ id }),
      })
    } else {
      factory.mockReturnValue((id: string) => ({ id }))
    }
    env.AI_PROVIDER = provider
    env.AI_BASE_URL = baseURL
    env.AI_API_KEY = 'test-key'
    const { getModel } = await import('./ai')
    await getModel('test-model')
    return factory.mock.calls[0]?.[0]?.headers as
      | Record<string, string>
      | undefined
  }

  it('passes x-opencode-session to the openai-compatible provider on Go', async () => {
    const headers = await freshModelWith('openai-compatible', GO_CHAT_URL)
    expect(mocks.createOpenAICompatible).toHaveBeenCalledTimes(1)
    expect(headers?.['x-opencode-session']).toMatch(UUID_RE)
  })

  it('passes x-opencode-session to every provider on Go', async () => {
    for (const provider of [
      'anthropic',
      'google',
      'openai',
      'openai-compatible',
    ] as const) {
      const headers = await freshModelWith(provider, GO_RESPONSES_URL)
      expect(headers?.['x-opencode-session']).toMatch(UUID_RE)
    }
  })

  it('passes empty headers off the Go endpoint', async () => {
    const headers = await freshModelWith(
      'openai-compatible',
      'https://openrouter.ai/api/v1',
    )
    expect(headers).toEqual({})
  })
})
