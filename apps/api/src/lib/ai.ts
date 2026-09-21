import { randomUUID } from 'node:crypto'

import type { createAnthropic } from '@ai-sdk/anthropic'
import type { createGoogle } from '@ai-sdk/google'
import type { createOpenAI } from '@ai-sdk/openai'
import type { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import { env } from './env'

const options = {
  apiKey: env.AI_API_KEY,
  baseURL: env.AI_BASE_URL,
}

// Stable per-process session ID for the OpenCode Go endpoint
// (https://opencode.ai/docs/go/#where-can-i-use-it). Go rejects requests
// missing `x-opencode-session` because they cannot be routed efficiently.
const openCodeSessionId = randomUUID()

export function isOpenCodeGoEndpoint(baseURL?: string): boolean {
  return !!baseURL && baseURL.includes('opencode.ai/zen/go')
}

export function getOpenCodeGoHeaders(): Record<string, string> {
  return isOpenCodeGoEndpoint(env.AI_BASE_URL)
    ? { 'x-opencode-session': openCodeSessionId }
    : {}
}

let anthropic: ReturnType<typeof createAnthropic> | undefined
let google: ReturnType<typeof createGoogle> | undefined
let openai: ReturnType<typeof createOpenAI> | undefined
let openaiCompatible: ReturnType<typeof createOpenAICompatible> | undefined

export async function getModel(modelId: string) {
  const headers = getOpenCodeGoHeaders()
  switch (env.AI_PROVIDER) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      anthropic ??= createAnthropic({ ...options, headers })
      return anthropic(modelId)
    }
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      google ??= createGoogle({ ...options, headers })
      return google(modelId)
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } =
        await import('@ai-sdk/openai-compatible')
      openaiCompatible ??= createOpenAICompatible({
        name: 'configured-ai-provider',
        ...options,
        baseURL: env.AI_BASE_URL ?? 'https://api.openai.com/v1',
        headers,
      })
      return openaiCompatible(modelId)
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      openai ??= createOpenAI({ ...options, headers })
      return openai.responses(modelId)
    }
  }
}
