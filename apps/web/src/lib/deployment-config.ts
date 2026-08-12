import { useQuery } from '@tanstack/react-query'

import { getTrpcClient } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

export type DeploymentConfig = Pick<
  AppRouterOutput['features']['get'],
  | 'defaultCurrencyCode'
  | 'enableGoogleOAuth'
  | 'enableGitHubOAuth'
  | 'signupMode'
  | 'allowUninvitedSignup'
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
    signupMode: 'open',
    allowUninvitedSignup: true,
  }
}

export function useDeploymentConfig(): DeploymentConfig {
  const query = useQuery({
    queryKey: ['deployment-config'],
    queryFn: () => getTrpcClient().features.get.query(),
    select: ({
      defaultCurrencyCode,
      enableGoogleOAuth,
      enableGitHubOAuth,
      signupMode,
      allowUninvitedSignup,
    }): DeploymentConfig => ({
      defaultCurrencyCode,
      enableGoogleOAuth,
      enableGitHubOAuth,
      signupMode,
      allowUninvitedSignup,
    }),
    staleTime: Infinity,
    enabled: import.meta.env.MODE !== 'test',
  })

  return query.data ?? getBuildTimeFallback()
}
