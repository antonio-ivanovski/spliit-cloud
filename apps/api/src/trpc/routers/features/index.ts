import { z } from 'zod'

import { allowUninvitedSignup } from '../../../lib/auth/signup-gate'
import { env, getConfiguredOidcProvider } from '../../../lib/env'
import { baseProcedure, createTRPCRouter } from '../../init'

export const featuresRouter = createTRPCRouter({
  get: baseProcedure
    .output(
      z.object({
        enableExpenseDocuments: z.boolean(),
        enableReceiptExtract: z.boolean(),
        enableVoiceExpense: z.boolean(),
        enableCategoryExtract: z.boolean(),
        enableBulkCategorize: z.boolean(),
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
      }),
    )
    .query(async () => {
      const oidc = getConfiguredOidcProvider(env)
      return {
        enableExpenseDocuments: env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
        enableReceiptExtract: env.PUBLIC_ENABLE_RECEIPT_EXTRACT,
        enableVoiceExpense: env.PUBLIC_ENABLE_VOICE_EXPENSE,
        enableCategoryExtract: env.PUBLIC_ENABLE_CATEGORY_EXTRACT,
        enableBulkCategorize: env.PUBLIC_ENABLE_BULK_CATEGORIZE,
        defaultCurrencyCode: env.PUBLIC_DEFAULT_CURRENCY_CODE,
        enableGoogleOAuth: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        enableGitHubOAuth: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        enableTwitterOAuth: !!(
          env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET
        ),
        oidcProviders: oidc ? [{ id: oidc.id, name: oidc.name }] : [],
        signupMode: env.SIGNUP_MODE,
        allowUninvitedSignup: await allowUninvitedSignup(),
        enableAnonymousAuth:
          env.ENABLE_ANONYMOUS_AUTH && env.SIGNUP_MODE === 'open',
      }
    }),
})
