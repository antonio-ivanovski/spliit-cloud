import { getRouteApi } from '@tanstack/react-router'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'

import { OAuthShell } from './oauth-shell'

const route = getRouteApi('/oauth/manual-callback')

/**
 * Display-only landing page for OAuth clients that cannot receive a redirect
 * (agents, CLIs). The authorization server sends the user here with
 * `?code=…&state=…`; the page shows what to paste back. It never touches the
 * network and never redeems the code — only the agent holding the PKCE verifier
 * can do that.
 */
export function OAuthManualCallbackPage() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'OAuth.manualCallback',
  })
  const {
    code,
    state,
    error,
    error_description: errorDescription,
  } = route.useSearch()
  const [urlCopied, setUrlCopied] = useState(false)
  const [callbackUrl] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.href,
  )

  async function copyCallbackUrl() {
    if (!callbackUrl) return
    try {
      await navigator.clipboard.writeText(callbackUrl)
    } catch {
      // Clipboard may be unavailable (permissions, insecure context);
      // the user can still select and copy the URL manually.
    }
    setUrlCopied(true)
    setTimeout(() => setUrlCopied(false), 1500)
  }

  if (error) {
    return (
      <OAuthShell title={t('errorTitle')} description={t('errorDescription')}>
        <div className="grid gap-2">
          <p
            className="truncate font-mono text-sm text-destructive"
            dir="ltr"
            translate="no"
            title={error}
          >
            {error}
          </p>
          {errorDescription ? (
            <p className="text-sm">{errorDescription}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('missingError')}</p>
        </div>
      </OAuthShell>
    )
  }

  if (!code) {
    return (
      <OAuthShell
        title={t('missingTitle')}
        description={t('missingDescription')}
      >
        <p className="text-sm text-destructive" role="alert">
          {t('missingError')}
        </p>
      </OAuthShell>
    )
  }

  return (
    <OAuthShell title={t('title')} description={t('description')}>
      <div className="grid gap-3">
        <ol className="grid list-decimal gap-1 ps-5 text-sm">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li className="text-muted-foreground">{t('step3')}</li>
        </ol>

        <Button
          type="button"
          className="w-full sm:w-auto sm:min-w-64"
          onClick={() => void copyCallbackUrl()}
        >
          {urlCopied ? (
            <Check className="me-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="me-2 h-4 w-4" aria-hidden="true" />
          )}
          {urlCopied ? t('copied') : t('copyUrl')}
        </Button>
        <output aria-live="polite" className="sr-only">
          {urlCopied ? t('copied') : ''}
        </output>

        <section
          className="grid gap-2 rounded-xl border bg-muted/35 px-2.5 py-2"
          aria-label={t('codeLabel')}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('codeLabel')}
            </p>
            <CopyButton
              text={code}
              ariaLabel={t('copyCode')}
              copiedLabel={t('copied')}
            />
          </div>
          <p className="font-mono text-sm break-all" dir="ltr" translate="no">
            {code}
          </p>
          {state ? (
            <p className="text-xs text-muted-foreground">
              {t('stateLabel')}:{' '}
              <span className="font-mono" dir="ltr" translate="no">
                {state}
              </span>
            </p>
          ) : null}
        </section>

        <div className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          />
          <div className="grid gap-1">
            <p className="text-xs leading-5 text-muted-foreground">
              {t('warning')}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('expiryNote')}
            </p>
          </div>
        </div>
      </div>
    </OAuthShell>
  )
}
