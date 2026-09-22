import { useQuery } from '@tanstack/react-query'

import { useOnlineStatus } from '@/lib/use-online-status'
import { getTrpcClient } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { MAX_EXPENSE_DOCUMENT_SIZE } from '@spliit/domain'

type BaseDeploymentConfig = Pick<
  AppRouterOutput['features']['get'],
  | 'defaultCurrencyCode'
  | 'enableGoogleOAuth'
  | 'enableGitHubOAuth'
  | 'enableTwitterOAuth'
  | 'oidcProviders'
  | 'signupMode'
  | 'allowUninvitedSignup'
  | 'enableAnonymousAuth'
  | 'enableEmailAuth'
  | 'enablePasskeyAuth'
  | 'passkeyFreshAgeSeconds'
  | 'maxExpenseDocumentSize'
>

export type DeploymentConfig = BaseDeploymentConfig & {
  /**
   * Whether the instance can deliver email. `null` while the features query has
   * not resolved (or offline) — consumers must treat unknown as neutral: no
   * delivery warnings, no disabled controls.
   */
  emailDeliveryEnabled: boolean | null
}

function getBuildTimeFallback(): DeploymentConfig {
  return {
    defaultCurrencyCode: import.meta.env.VITE_DEFAULT_CURRENCY_CODE || 'USD',
    enableGoogleOAuth:
      import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === 'true' ||
      import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === '1',
    enableGitHubOAuth:
      import.meta.env.VITE_ENABLE_GITHUB_OAUTH === 'true' ||
      import.meta.env.VITE_ENABLE_GITHUB_OAUTH === '1',
    enableTwitterOAuth:
      import.meta.env.VITE_ENABLE_TWITTER_OAUTH === 'true' ||
      import.meta.env.VITE_ENABLE_TWITTER_OAUTH === '1',
    oidcProviders: [],
    signupMode: 'open',
    allowUninvitedSignup: true,
    enableAnonymousAuth: false,
    enableEmailAuth: true,
    enablePasskeyAuth: true,
    // Must match SESSION_FRESH_AGE_SECONDS on the API. Only used when the
    // features query has not resolved (offline / test); otherwise the server
    // value wins.
    passkeyFreshAgeSeconds: 30 * 24 * 60 * 60,
    emailDeliveryEnabled: null,
    maxExpenseDocumentSize: MAX_EXPENSE_DOCUMENT_SIZE,
  }
}

export function useDeploymentConfig(): DeploymentConfig {
  const isOnline = useOnlineStatus()
  const query = useQuery({
    queryKey: ['deployment-config'],
    queryFn: () => getTrpcClient().features.get.query(),
    select: ({
      defaultCurrencyCode,
      enableGoogleOAuth,
      enableGitHubOAuth,
      enableTwitterOAuth,
      oidcProviders,
      signupMode,
      allowUninvitedSignup,
      enableAnonymousAuth,
      enableEmailAuth,
      enablePasskeyAuth,
      passkeyFreshAgeSeconds,
      emailDeliveryEnabled,
      maxExpenseDocumentSize,
    }): DeploymentConfig => ({
      defaultCurrencyCode,
      enableGoogleOAuth,
      enableGitHubOAuth,
      enableTwitterOAuth,
      oidcProviders,
      signupMode,
      allowUninvitedSignup,
      enableAnonymousAuth,
      enableEmailAuth,
      enablePasskeyAuth,
      passkeyFreshAgeSeconds,
      emailDeliveryEnabled,
      maxExpenseDocumentSize,
    }),
    staleTime: Infinity,
    enabled: import.meta.env.MODE !== 'test' && isOnline,
  })

  return query.data ?? getBuildTimeFallback()
}
