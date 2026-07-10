import type { createAnthropic } from '@ai-sdk/anthropic'
import type { createGoogle } from '@ai-sdk/google'
import type { createOpenAI } from '@ai-sdk/openai'
import type { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { env } from './env'

const options = {
  apiKey: env.AI_API_KEY,
  baseURL: env.AI_BASE_URL,
}
let anthropic: ReturnType<typeof createAnthropic> | undefined
let google: ReturnType<typeof createGoogle> | undefined
let openai: ReturnType<typeof createOpenAI> | undefined
let openaiCompatible: ReturnType<typeof createOpenAICompatible> | undefined

export async function getModel(modelId: string) {
  switch (env.AI_PROVIDER) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      anthropic ??= createAnthropic(options)
      return anthropic(modelId)
    }
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      google ??= createGoogle(options)
      return google(modelId)
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } =
        await import('@ai-sdk/openai-compatible')
      openaiCompatible ??= createOpenAICompatible({
        name: 'configured-ai-provider',
        ...options,
        baseURL: env.AI_BASE_URL ?? 'https://api.openai.com/v1',
      })
      return openaiCompatible(modelId)
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      openai ??= createOpenAI(options)
      return openai.responses(modelId)
    }
  }
}
