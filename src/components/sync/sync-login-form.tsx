'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSyncAuth } from '@/lib/auth/use-sync-auth'
import { Mail } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'

type OAuthProviders = {
  google: boolean
  github: boolean
}

const providerLabel = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
}

export function SyncLoginForm({
  oauthProviders,
}: {
  oauthProviders: OAuthProviders
}) {
  const { login } = useSyncAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const [error, setError] = useState('')

  const providers = useMemo(
    () =>
      (['google', 'github'] as const).filter(
        (provider) => oauthProviders[provider],
      ),
    [oauthProviders],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatus('sending')
    try {
      await login(email)
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to send link')
    }
  }

  const content = (
    <div className="space-y-6">
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="sync-email">
            Email
          </label>
          <Input
            id="sync-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={status === 'sending'}>
          <Mail className="mr-2 h-4 w-4" />
          {status === 'sent' ? 'Magic link sent' : 'Send magic link'}
        </Button>
        {status === 'sent' ? (
          <p className="text-sm text-muted-foreground">
            Check your inbox for a sign-in link.
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </form>

      {providers.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-3">
            {providers.map((provider) => (
              <Button
                key={provider}
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.href = `/api/auth/oauth/${provider}`
                }}
                type="button"
              >
                {providerLabel[provider]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )

    return content
}
