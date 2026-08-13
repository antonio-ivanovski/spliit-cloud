import { Ellipsis, KeyRound, RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'

export function PublicViewOnlyLinkSection({ groupId }: { groupId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupViewLink' })
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const publicView = trpc.groups.view.get.useQuery({ groupId })
  const [confirmation, setConfirmation] = useState<'replace' | 'remove' | null>(
    null,
  )

  const refresh = async () => {
    setConfirmation(null)
    await utils.groups.view.get.invalidate({ groupId })
  }
  const failure = (error: { message: string }) =>
    toast({ description: error.message, variant: 'destructive' })
  const enable = trpc.groups.view.enable.useMutation({
    onSuccess: () => void refresh(),
    onError: failure,
  })
  const replace = trpc.groups.view.replace.useMutation({
    onSuccess: () => void refresh(),
    onError: failure,
  })
  const remove = trpc.groups.view.remove.useMutation({
    onSuccess: () => void refresh(),
    onError: failure,
  })

  const url = publicView.data?.url ?? null
  const canManage = publicView.data?.canManage === true
  const pending = enable.isPending || replace.isPending || remove.isPending

  return (
    <>
      <Card className="mobile-surface mb-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {url ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('enabledStatus')}
              </p>
              <div className="flex overflow-hidden rounded-lg border bg-muted/20 shadow-xs transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                <Input
                  value={url}
                  readOnly
                  aria-label={t('linkLabel')}
                  className="min-w-0 flex-1 rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton
                  text={url}
                  ariaLabel={t('copy')}
                  copiedLabel={t('copied')}
                  variant="ghost"
                  className="shrink-0 rounded-none border-s"
                />
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="hidden shrink-0 rounded-none border-s sm:inline-flex"
                      disabled={pending}
                      aria-label={t('replace')}
                      onClick={() => setConfirmation('replace')}
                    >
                      <RotateCw className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="hidden shrink-0 rounded-none border-s text-destructive hover:text-destructive sm:inline-flex"
                      disabled={pending}
                      aria-label={t('remove')}
                      onClick={() => setConfirmation('remove')}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                    <div className="sm:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="shrink-0 rounded-none border-s"
                              disabled={pending}
                              aria-label={`${t('replace')} / ${t('remove')}`}
                            />
                          }
                        >
                          <Ellipsis className="size-4" aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem
                            onClick={() => setConfirmation('replace')}
                          >
                            <RotateCw
                              className="me-2 size-4"
                              aria-hidden="true"
                            />
                            {t('replace')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setConfirmation('remove')}
                          >
                            <Trash2
                              className="me-2 size-4"
                              aria-hidden="true"
                            />
                            {t('remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t('warning')}</p>
            </div>
          ) : canManage ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || publicView.isLoading}
                onClick={() => enable.mutate({ groupId })}
              >
                <KeyRound className="me-2 size-4" aria-hidden="true" />
                {t('enable')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ResponsiveDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {confirmation === 'replace'
                ? t('replaceDialogTitle')
                : t('removeDialogTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {confirmation === 'replace'
                ? t('replaceDialogDescription')
                : t('removeDialogDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant={confirmation === 'remove' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => {
                if (confirmation === 'replace') {
                  replace.mutate({ groupId, confirmed: true })
                } else if (confirmation === 'remove') {
                  remove.mutate({ groupId, confirmed: true })
                }
              }}
            >
              {confirmation === 'replace'
                ? t('replaceConfirm')
                : t('removeConfirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
