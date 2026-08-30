import { Link } from '@tanstack/react-router'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { PageInset, PageShell } from '@/components/layout/page-shell'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AnonymousRecoveryError,
  parseAnonymousRecoveryLink,
  recoverAnonymousAccount,
} from '@/lib/anonymous-recovery'
import { replaceBrowserLocation } from '@/lib/browser-navigation'

function readRecoveryCodeFromHash() {
  return parseAnonymousRecoveryLink(window.location.href)
}

export function RecoverAnonymousAccountPage() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AnonymousAccount.recover',
  })
  const [initialCode] = useState(readRecoveryCodeFromHash)
  const [recoveryLink, setRecoveryLink] = useState('')
  const [attemptedCode, setAttemptedCode] = useState(initialCode ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [conflictName, setConflictName] = useState<string | null>(null)
  const attemptedInitialRecovery = useRef(false)

  const attemptRecovery = useCallback(
    async (recoveryCode: string, replaceCurrentSession = false) => {
      setAttemptedCode(recoveryCode)
      setPending(true)
      setError(false)
      setConflictName(null)
      try {
        await recoverAnonymousAccount({
          code: recoveryCode,
          replaceCurrentSession,
        })
        replaceBrowserLocation('/')
      } catch (cause) {
        if (
          cause instanceof AnonymousRecoveryError &&
          cause.code === 'ANONYMOUS_RECOVERY_ACCOUNT_CONFLICT'
        ) {
          setConflictName(cause.displayName ?? t('anonymousAccount'))
        } else {
          setError(true)
        }
      } finally {
        setPending(false)
      }
    },
    [t],
  )

  async function recover(replaceCurrentSession = false) {
    const recoveryCode =
      replaceCurrentSession && conflictName
        ? attemptedCode
        : parseAnonymousRecoveryLink(recoveryLink)
    if (!recoveryCode) {
      setError(true)
      return
    }
    await attemptRecovery(recoveryCode, replaceCurrentSession)
  }

  useLayoutEffect(() => {
    if (!window.location.hash) return
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }, [])

  useEffect(() => {
    if (!initialCode || attemptedInitialRecovery.current) return
    attemptedInitialRecovery.current = true
    queueMicrotask(() => void attemptRecovery(initialCode))
  }, [attemptRecovery, initialCode])

  if (initialCode && !error && !conflictName) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
        <PageInset className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{t('recovering')}</p>
        </PageInset>
      </main>
    )
  }

  return (
    <PageShell width="full" className="items-center justify-center py-10">
      <Card className="w-full max-w-lg overflow-hidden border-primary/15 shadow-lg">
        <div className="h-1.5 bg-linear-to-r from-emerald-500 via-primary to-teal-400" />
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
            {t('howItWorks')}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="anonymous-recovery-link">{t('linkLabel')}</Label>
            <Input
              id="anonymous-recovery-link"
              value={recoveryLink}
              onChange={(event) => setRecoveryLink(event.target.value)}
              className="font-mono text-xs"
              autoComplete="off"
              autoCapitalize="none"
              inputMode="url"
              spellCheck={false}
              placeholder="https://…/auth/recover#code=…"
            />
          </div>
          {pending ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('recovering')}
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t('invalid')}
            </p>
          ) : null}
          {conflictName ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4">
              <p className="font-medium">{t('switchTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('switchDescription', { name: conflictName })}
              </p>
              <Button
                className="mt-4 w-full"
                onClick={() => void recover(true)}
              >
                <ShieldCheck className="me-2 h-4 w-4" />
                {t('switchConfirm')}
              </Button>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {!conflictName ? (
            <Button
              className="w-full"
              disabled={pending || !recoveryLink.trim()}
              onClick={() => void recover()}
            >
              {t('submit')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/" />}
            className="w-full"
          >
            {t('back')}
          </Button>
        </CardFooter>
      </Card>
    </PageShell>
  )
}
