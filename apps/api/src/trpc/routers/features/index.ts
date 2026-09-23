import { z } from 'zod'

import { SESSION_FRESH_AGE_SECONDS } from '../../../lib/auth/session-policy'
import { allowUninvitedSignup } from '../../../lib/auth/signup-gate'
import {
  env,
  getConfiguredOidcProvider,
  isEmailAuthEnabled,
  isEmailDeliveryEnabled,
  isPasskeyAuthEnabled,
  getMaxExpenseDocumentSizeBytes,
} from '../../../lib/env'
import { baseProcedure, createTRPCRouter } from '../../init'

export const featuresRouter = createTRPCRouter({
  get: baseProcedure
    .output(
      z.object({
        enableExpenseDocuments: z.boolean(),
        maxExpenseDocumentSize: z.number().int().positive(),
        enableReceiptExtract: z.boolean(),
        enableVoiceExpense: z.boolean(),
        enableCategoryExtract: z.boolean(),
        enableBulkCategorize: z.boolean(),
        bulkCategorizeSystemOneAvailable: z.boolean(),
        enableDictionarySuggest: z.boolean(),
        enableHistorySuggest: z.boolean(),
        categoryEngine: z.enum(['llm', 'system-one']),
        categoryLocalThresholds: z.object({
          minScore: z.number(),
          settlementMinScore: z.number(),
        }),
        /** Active AI confidence floor (informational; enforced server-side). */
        aiMinConfidence: z.number(),
        defaultCurrencyCode: z.string(),
        enableGoogleOAuth: z.boolean(),
        enableGitHubOAuth: z.boolean(),
        enableTwitterOAuth: z.boolean(),
        oidcProviders: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
          }),
        ),
        signupMode: z.enum(['open', 'invite_only']),
        allowUninvitedSignup: z.boolean(),
        enableAnonymousAuth: z.boolean(),
        enableEmailAuth: z.boolean(),
        enablePasskeyAuth: z.boolean(),
        /**
         * Session freshness window (seconds) the server enforces on passkey
         * enrollment. The client mirrors the check proactively so stale
         * sessions get a re-auth prompt instead of a `SESSION_NOT_FRESH`
         * failure mid-ceremony.
         */
        passkeyFreshAgeSeconds: z.number().int().nonnegative(),
        emailDeliveryEnabled: z.boolean(),
      }),
    )
    .query(async () => {
      const oidc = getConfiguredOidcProvider(env)
      return {
        enableExpenseDocuments: env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
        maxExpenseDocumentSize: getMaxExpenseDocumentSizeBytes(),
        enableReceiptExtract: env.PUBLIC_ENABLE_RECEIPT_EXTRACT,
        enableVoiceExpense: env.PUBLIC_ENABLE_VOICE_EXPENSE,
        enableCategoryExtract: env.PUBLIC_ENABLE_CATEGORY_EXTRACT,
        enableBulkCategorize: true,
        bulkCategorizeSystemOneAvailable: Boolean(env.AI_SYSTEM_ONE_API_KEY),
        enableDictionarySuggest: env.CATEGORY_DICTIONARY_ENABLED,
        enableHistorySuggest: env.CATEGORY_HISTORY_ENABLED,
        categoryEngine: env.AI_CATEGORY_ENGINE,
        categoryLocalThresholds: {
          minScore: env.CATEGORY_LOCAL_MIN_SCORE,
          settlementMinScore: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
        },
        aiMinConfidence: env.AI_CATEGORY_MIN_CONFIDENCE,
        defaultCurrencyCode: env.PUBLIC_DEFAULT_CURRENCY_CODE,
        enableGoogleOAuth: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        enableGitHubOAuth: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        enableTwitterOAuth: !!(
          env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET
        ),
        oidcProviders: oidc ? [{ id: oidc.id, name: oidc.name }] : [],
        signupMode: env.SIGNUP_MODE,
        allowUninvitedSignup: await allowUninvitedSignup(),
        enableAnonymousAuth: env.ENABLE_ANONYMOUS_AUTH,
        enableEmailAuth: isEmailAuthEnabled(),
        enablePasskeyAuth: isPasskeyAuthEnabled(),
        passkeyFreshAgeSeconds: SESSION_FRESH_AGE_SECONDS,
        emailDeliveryEnabled: isEmailDeliveryEnabled(),
      }
    }),
})
