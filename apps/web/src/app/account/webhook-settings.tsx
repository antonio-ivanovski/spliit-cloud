import {
  BookOpen,
  Copy,
  Eye,
  Loader2,
  MoreHorizontal,
  Plus,
  Webhook,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DeletePopup } from '@/components/delete-popup'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

import {
  SettingsBadge,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from './settings-ui'
import {
  WebhookFormDialog,
  type WebhookEndpoint,
  type WebhookFormMode,
} from './webhook-form-dialog'

type Endpoint = AppRouterOutput['webhooks']['list'][number]

const WEBHOOK_DOCS_URL =
  'https://github.com/antonio-ivanovski/spliit-cloud/blob/main/docs/webhooks.md'

type FormState = {
  mode: WebhookFormMode
  endpoint: WebhookEndpoint | null
}

export function WebhookSettings() {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountWebhooks' })
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const endpoints = trpc.webhooks.list.useQuery()
  const [form, setForm] = useState<FormState | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [historyEndpoint, setHistoryEndpoint] = useState<Endpoint | null>(null)

  const refresh = () => utils.webhooks.list.invalidate()

  return (
    <>
      <SettingsSection
        id="webhooks"
        title={t('title')}
        description={t('description')}
        icon={Webhook}
        status={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              render={
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- Button render merges the Docs label into the anchor.
                <a href={WEBHOOK_DOCS_URL} target="_blank" rel="noreferrer" />
              }
            >
              <BookOpen className="me-2 size-4" />
              {t('docs')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setForm({ mode: 'create', endpoint: null })}
            >
              <Plus className="me-2 size-4" />
              {t('createWebhook')}
            </Button>
          </div>
        }
      >
        {endpoints.isPending ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6">
            {t('loading')}
          </p>
        ) : endpoints.isError ? (
          <p
            className="px-4 pb-4 text-sm text-destructive sm:px-6"
            role="alert"
          >
            {endpoints.error.message}
          </p>
        ) : endpoints.data.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6">
            {t('empty')}
          </p>
        ) : (
          <SettingsList className="border-t border-border/70">
            {endpoints.data.map((endpoint) => (
              <EndpointRow
                key={endpoint.id}
                endpoint={endpoint}
                onSecret={setSecret}
                onHistory={() => setHistoryEndpoint(endpoint)}
                onView={() =>
                  setForm({
                    mode: 'view',
                    endpoint: endpoint as WebhookEndpoint,
                  })
                }
                onRefresh={refresh}
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <WebhookFormDialog
        mode={form?.mode ?? 'create'}
        endpoint={form?.endpoint ?? null}
        open={form !== null}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        onEdit={() =>
          setForm((prev) =>
            prev?.endpoint ? { mode: 'edit', endpoint: prev.endpoint } : prev,
          )
        }
        onSecret={setSecret}
      />

      <ResponsiveDialog
        open={secret !== null}
        onOpenChange={(open) => !open && setSecret(null)}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('secretTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('secretDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <code className="block rounded-md bg-muted p-3 text-xs break-all">
              {secret}
            </code>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              onClick={() => {
                if (secret) void navigator.clipboard.writeText(secret)
                toast({ title: t('copied') })
              }}
            >
              <Copy className="me-2 size-4" />
              {t('copy')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <DeliveryHistory
        endpoint={historyEndpoint}
        onClose={() => setHistoryEndpoint(null)}
      />
    </>
  )
}

function EndpointRow({
  endpoint,
  onSecret,
  onHistory,
  onView,
  onRefresh,
}: {
  endpoint: Endpoint
  onSecret: (secret: string) => void
  onHistory: () => void
  onView: () => void
  onRefresh: () => Promise<unknown>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountWebhooks' })
  const { toast } = useToast()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const test = trpc.webhooks.test.useMutation({
    onSuccess: () => toast({ title: t('testQueued') }),
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const rotate = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: async ({ secret }) => {
      onSecret(secret)
      await onRefresh()
    },
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const remove = trpc.webhooks.delete.useMutation({
    onSuccess: onRefresh,
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const pending = test.isPending || rotate.isPending || remove.isPending

  return (
    <SettingsRow
      id={`webhook-${endpoint.id}`}
      label={endpoint.name}
      badges={
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
            endpoint.enabled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              endpoint.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/50',
            )}
          />
          {endpoint.enabled ? t('enabled') : t('disabled')}
        </span>
      }
      description={
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-mono text-xs break-all">{endpoint.url}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs">{t('eventsLabel')}:</span>
            {endpoint.notifyCreated ? (
              <SettingsBadge>{t('eventsCreated')}</SettingsBadge>
            ) : null}
            {endpoint.notifyUpdated ? (
              <SettingsBadge>{t('eventsUpdated')}</SettingsBadge>
            ) : null}
            {endpoint.notifyDeleted ? (
              <SettingsBadge>{t('eventsDeleted')}</SettingsBadge>
            ) : null}
            {endpoint.involvedOnly ? (
              <SettingsBadge>{t('involvedOnlyBadge')}</SettingsBadge>
            ) : null}
            {endpoint.latestDelivery ? (
              <SettingsBadge>{endpoint.latestDelivery.status}</SettingsBadge>
            ) : null}
          </div>
        </div>
      }
      control={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            title={t('view')}
            aria-label={t('view')}
            onClick={onView}
          >
            <Eye className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={pending}
                  aria-label={t('actions')}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => test.mutate({ endpointId: endpoint.id })}
                disabled={pending}
              >
                {t('test')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onHistory}>
                {t('history')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => rotate.mutate({ endpointId: endpoint.id })}
                disabled={pending}
              >
                {t('rotate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={pending}
              >
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DeletePopup
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            labels={{
              title: t('delete'),
              description: t('deleteConfirmDescription'),
              yes: t('deleteConfirm'),
            }}
            onDelete={() => remove.mutateAsync({ endpointId: endpoint.id })}
          />
        </div>
      }
    />
  )
}

function DeliveryHistory({
  endpoint,
  onClose,
}: {
  endpoint: Endpoint | null
  onClose: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountWebhooks' })
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = trpc.webhooks.deliveries.useQuery(
    { endpointId: endpoint?.id ?? '', limit: 25 },
    { enabled: endpoint !== null },
  )
  const detail = trpc.webhooks.delivery.useQuery(
    { deliveryId: selectedId ?? '' },
    { enabled: selectedId !== null },
  )
  const redeliver = trpc.webhooks.redeliver.useMutation({
    onSuccess: () => history.refetch(),
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const close = () => {
    setSelectedId(null)
    onClose()
  }

  return (
    <ResponsiveDialog
      open={endpoint !== null}
      onOpenChange={(open) => !open && close()}
    >
      <ResponsiveDialogContent className="sm:max-w-3xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('historyTitle', { name: endpoint?.name })}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('historyDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="max-h-[65vh] overflow-y-auto">
          {history.isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : null}
          {history.data?.deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
          ) : null}
          <div className="space-y-2">
            {history.data?.deliveries.map((delivery) => (
              <button
                key={delivery.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-start"
                onClick={() => setSelectedId(delivery.id)}
              >
                <span>
                  <span className="font-medium">{delivery.event.type}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(delivery.event.occurredAt).toLocaleString()}
                  </span>
                </span>
                <SettingsBadge>{delivery.status}</SettingsBadge>
              </button>
            ))}
          </div>
          {detail.data ? (
            <div className="mt-4 space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{t('deliveryDetails')}</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !endpoint?.enabled ||
                    redeliver.isPending ||
                    detail.data.status === 'PENDING' ||
                    detail.data.status === 'PROCESSING'
                  }
                  onClick={() =>
                    redeliver.mutate({ deliveryId: detail.data.id })
                  }
                >
                  {t('redeliver')}
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(detail.data.event.payload, null, 2)}
              </pre>
              <p className="text-xs text-muted-foreground">
                {t('attemptCount', { count: detail.data.attempts.length })}
              </p>
            </div>
          ) : null}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
