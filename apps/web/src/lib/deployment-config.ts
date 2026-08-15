import { useQuery } from '@tanstack/react-query'

import { useOnlineStatus } from '@/lib/use-online-status'
import { getTrpcClient } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

export type DeploymentConfig = Pick<
  AppRouterOutput['features']['get'],
  | 'defaultCurrencyCode'
  | 'enableGoogleOAuth'
  | 'enableGitHubOAuth'
  | 'enableTwitterOAuth'
  | 'oidcProviders'
  | 'signupMode'
  | 'allowUninvitedSignup'
  | 'enableAnonymousAuth'
>

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
    }): DeploymentConfig => ({
      defaultCurrencyCode,
      enableGoogleOAuth,
      enableGitHubOAuth,
      enableTwitterOAuth,
      oidcProviders,
      signupMode,
      allowUninvitedSignup,
      enableAnonymousAuth,
    }),
    staleTime: Infinity,
    enabled: import.meta.env.MODE !== 'test' && isOnline,
  })

  return query.data ?? getBuildTimeFallback()
}
