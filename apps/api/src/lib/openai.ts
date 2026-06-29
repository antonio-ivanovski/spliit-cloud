import OpenAI from 'openai'
import { env } from './env'

let openai: OpenAI | undefined

export function getOpenAIClient() {
  openai ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
  })

  return openai
}
