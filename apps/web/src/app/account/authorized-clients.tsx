import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

import { SettingsSection } from './settings-ui'

type AuthorizedClient =
  AppRouterOutput['account']['authorizedClients']['clients'][number]

/** `spliit:expenses:write` reads better as `expenses write`. */
function scopeLabel(scope: string): string {
  return scope.startsWith('spliit:')
    ? scope.slice('spliit:'.length).replace(/:/g, ' ')
    : scope
}

/** OIDC scopes say nothing about what an app can reach in Spliit. */
function meaningfulScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => scope.startsWith('spliit:'))
}

export function AuthorizedClients() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const [pendingRevoke, setPendingRevoke] = useState<AuthorizedClient | null>(
    null,
  )

  const authorized = trpc.account.authorizedClients.useQuery()
  const revoke = trpc.account.revokeAuthorizedClient.useMutation({
    onSuccess: async () => {
      await utils.account.authorizedClients.invalidate()
      toast({ title: t('AccountAuthorizedClients.revoked') })
      setPendingRevoke(null)
    },
    onError: () => {
      toast({
        title: t('AccountAuthorizedClients.revokeFailed'),
        variant: 'destructive',
      })
    },
  })

  const clients = authorized.data?.clients ?? []
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
  })

  return (
    <>
      <SettingsSection
        id="authorized-clients"
        title={t('AccountAuthorizedClients.title')}
        description={t('AccountAuthorizedClients.description')}
        icon={KeyRound}
      >
        {authorized.isPending ? (
          <p className="text-sm text-muted-foreground">
            {t('AccountAuthorizedClients.loading')}
          </p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('AccountAuthorizedClients.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {clients.map((client) => {
              const scopes = meaningfulScopes(client.scopes)
              return (
                <li
                  key={client.consentId}
                  className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-col gap-2">
                    <span className="font-medium">
                      {client.name ??
                        t('AccountAuthorizedClients.unnamedClient')}
                    </span>
                    {scopes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {scopeLabel(scope)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {client.authorizedAt && (
                      <span className="text-xs text-muted-foreground">
                        {t('AccountAuthorizedClients.authorizedOn', {
                          date: dateFormat.format(
                            new Date(client.authorizedAt),
                          ),
                        })}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPendingRevoke(client)}
                  >
                    {t('AccountAuthorizedClients.revoke')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsSection>

      <ResponsiveDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('AccountAuthorizedClients.confirmTitle', {
                name:
                  pendingRevoke?.name ??
                  t('AccountAuthorizedClients.unnamedClient'),
              })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('AccountAuthorizedClients.confirmDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <p className="text-sm text-muted-foreground">
              {t('AccountAuthorizedClients.confirmGracePeriod')}
            </p>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose
              render={
                <Button type="button" variant="outline">
                  {t('AccountAuthorizedClients.cancel')}
                </Button>
              }
            />
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => {
                if (pendingRevoke) {
                  revoke.mutate({ consentId: pendingRevoke.consentId })
                }
              }}
            >
              {revoke.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t('AccountAuthorizedClients.revoke')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
