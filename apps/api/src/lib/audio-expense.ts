import { generateText, Output } from 'ai'
import { z } from 'zod'

import {
  categoryIdSchema,
  DEFAULT_CATEGORIES,
  getCurrency,
} from '@spliit/domain'

import { getModel } from './ai'
import { buildLocaleHint } from './ai/prompt'
import { env } from './env'

const audioModelOutputSchema = z
  .object({
    // Model output is intentionally permissive. We validate and normalize
    // every field below so one malformed optional value does not discard the
    // useful fields that were extracted alongside it.
    transcript: z.unknown().optional(),
    title: z.unknown().optional(),
    amount: z.unknown().optional(),
    currencyCode: z.unknown().optional(),
    date: z.unknown().optional(),
    categoryId: z.unknown().optional(),
    payerParticipantId: z.unknown().optional(),
    participantIds: z.unknown().optional(),
    languageCode: z.unknown().optional(),
    languageConfidence: z.unknown().optional(),
  })
  .loose()

export type AudioExpenseGroupContext = {
  id: string
  name: string
  currency: string
  currencyCode: string | null
}

export type AudioExpenseParticipantOption = {
  id: string
  name: string
}

export type AudioExpenseContext = {
  audioDataUrl: string
  locale?: string
  timezoneOffsetMinutes?: number
  group: AudioExpenseGroupContext
  participants: AudioExpenseParticipantOption[]
}

type AudioModelOutput = z.infer<typeof audioModelOutputSchema>

const issueValues = [
  'missingTitle',
  'missingAmount',
  'invalidDate',
  'unsupportedCurrency',
] as const

export type AudioExpenseIssue = (typeof issueValues)[number]

function buildPrompt(context: AudioExpenseContext, today: string) {
  const categoryIds = DEFAULT_CATEGORIES.map((category) => category.id)
  const localeHint = buildLocaleHint(context.locale)
  return `
You extract one simple expense request from an audio recording.
Return only one JSON object and never an explanation.
Today is ${today}.
${localeHint}
Current group context: ${JSON.stringify({
    name: context.group.name,
    currency: context.group.currency,
    currencyCode: context.group.currencyCode,
  })}
Allowed participants for payer and an explicitly named even split: ${JSON.stringify(context.participants)}.
Return participant IDs only when the spoken names clearly match; otherwise return null or an empty array.
The destination is already known. Do not ask for, infer, or return a group ID.
Allowed category IDs: ${categoryIds.join(', ')}.

First identify the dominant spoken language and your confidence. The app language is only a suggestion, not a requirement.
When confidence is high, write the title and other human-readable expense text in that language's
normal writing system and orthography. Do not transliterate into Latin letters when the language normally
uses another script. Preserve participant names, brand names, and proper nouns. When confidence is medium
or low, preserve the wording and script that you hear instead of translating it to the app language.

Return exactly these fields: transcript, title, amount, currencyCode, date, categoryId,
payerParticipantId, participantIds, languageCode, and languageConfidence.
Use a positive decimal major-unit amount, an ISO 4217 currency code only when the speaker clearly states
or strongly implies a currency, and a yyyy-mm-dd date. Missing details are valid: return null or [] and
do not invent facts. Infer relative dates from today. Do not convert currencies. Leave itemization, notes,
custom percentages, and multi-payer details for the full expense form.
`
}

function parseAmount(value: unknown) {
  const raw =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? String(value)
        : ''
      : typeof value === 'string'
        ? value.trim()
        : ''
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null
  const amount = Number(raw)
  return Number.isFinite(amount) && amount > 0 ? raw : null
}

function parseDate(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null
}

function uniqueIssues(issues: AudioExpenseIssue[]) {
  return [...new Set(issues)]
}

function normalizeOutput(
  parsed: AudioModelOutput,
  context: AudioExpenseContext,
) {
  const rawCurrencyCode =
    typeof parsed.currencyCode === 'string'
      ? parsed.currencyCode.trim().toUpperCase()
      : ''
  const explicitCurrency = rawCurrencyCode ? getCurrency(rawCurrencyCode) : null
  const currencyCode =
    explicitCurrency?.code ??
    (rawCurrencyCode || context.group.currencyCode || null)
  const amount = parseAmount(parsed.amount)
  const rawDate = typeof parsed.date === 'string' ? parsed.date.trim() : ''
  const date = parseDate(parsed.date)
  const title =
    typeof parsed.title === 'string' ? parsed.title.trim() || null : null
  const participantIds = new Set(context.participants.map(({ id }) => id))
  const payerParticipantId =
    typeof parsed.payerParticipantId === 'string' &&
    participantIds.has(parsed.payerParticipantId)
      ? parsed.payerParticipantId
      : null
  const namedParticipants = Array.isArray(parsed.participantIds)
    ? parsed.participantIds.filter(
        (id): id is string => typeof id === 'string' && participantIds.has(id),
      )
    : []
  const issues: AudioExpenseIssue[] = []
  if (!title) issues.push('missingTitle')
  if (!amount) issues.push('missingAmount')
  if (rawDate && !date) issues.push('invalidDate')
  if (rawCurrencyCode && !explicitCurrency) issues.push('unsupportedCurrency')

  return {
    transcript:
      typeof parsed.transcript === 'string'
        ? parsed.transcript.trim() || null
        : null,
    groupId: context.group.id,
    title,
    amount,
    currencyCode,
    date,
    categoryId: categoryIdSchema.safeParse(parsed.categoryId).success
      ? categoryIdSchema.parse(parsed.categoryId)
      : null,
    payerParticipantId,
    participantIds: [...new Set(namedParticipants)],
    issues: uniqueIssues(issues),
  }
}

export async function extractExpenseInformationFromAudio(
  context: AudioExpenseContext,
) {
  if (!env.AI_VOICE_MODEL) {
    throw new Error('AI_VOICE_MODEL is required for voice expense extraction')
  }
  const today = new Date(
    Date.now() - (context.timezoneOffsetMinutes ?? 0) * 60_000,
  )
    .toISOString()
    .slice(0, 10)
  const { output } = await generateText({
    model: await getModel(env.AI_VOICE_MODEL),
    instructions: buildPrompt(context, today),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: context.audioDataUrl,
            mediaType: 'audio/wav',
          },
          {
            type: 'text',
            text: 'Extract the expense from this recording.',
          },
        ],
      },
    ],
    // Keep JSON mode for audio-capable OpenAI-compatible models that do not
    // consistently support provider-specific structured output.
    output: Output.json(),
    maxOutputTokens: 700,
  })
  const parsed = audioModelOutputSchema.safeParse(output)
  return normalizeOutput(parsed.success ? parsed.data : {}, context)
}

export function buildAudioExpensePromptForTest(
  context: AudioExpenseContext,
  today = '2026-01-01',
) {
  return buildPrompt(context, today)
}
