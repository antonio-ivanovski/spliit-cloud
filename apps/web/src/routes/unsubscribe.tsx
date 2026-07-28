import { createFileRoute } from '@tanstack/react-router'

import { getTrpcClient } from '@/trpc/client'

export function readUnsubscribeToken(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return params.get('token') ?? ''
}

export const Route = createFileRoute('/unsubscribe')({
  loader: async ({ location }) => {
    const token = readUnsubscribeToken(location.hash)
    if (!token) return { token, preview: null }

    try {
      const preview =
        await getTrpcClient().notifications.unsubscribe.preview.query({ token })
      return { token, preview }
    } catch {
      return { token, preview: null }
    }
  },
})
