import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

export type WebhookFormMode = 'create' | 'edit' | 'view'
export type WebhookEndpoint = AppRouterOutput['webhooks']['list'][number]

const webhookFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.url().max(2048),
  enabled: z.boolean(),
  events: z
    .object({
      created: z.boolean(),
      updated: z.boolean(),
      deleted: z.boolean(),
      involvedOnly: z.boolean(),
    })
    .refine((value) => value.created || value.updated || value.deleted, {
      message: 'eventsRequired',
    }),
})

type WebhookFormValues = z.infer<typeof webhookFormSchema>

function endpointToValues(endpoint: WebhookEndpoint): WebhookFormValues {
  return {
    name: endpoint.name,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: {
      created: endpoint.notifyCreated,
      updated: endpoint.notifyUpdated,
      deleted: endpoint.notifyDeleted,
      involvedOnly: endpoint.involvedOnly,
    },
  }
}

const createDefaults: WebhookFormValues = {
  name: '',
  url: '',
  enabled: false,
  events: { created: true, updated: true, deleted: true, involvedOnly: false },
}

export function WebhookFormDialog({
  mode,
  endpoint,
  open,
  onOpenChange,
  onEdit,
  onSecret,
}: {
  mode: WebhookFormMode
  endpoint: WebhookEndpoint | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: () => void
  onSecret: (secret: string) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'AccountWebhooks' })
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const readOnly = mode === 'view'
  const lastKeyRef = useRef<string | null>(null)

  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: createDefaults,
  })
  const { isDirty } = form.formState

  useEffect(() => {
    if (!open) {
      lastKeyRef.current = null
      return
    }
    const key = mode === 'create' ? 'create' : (endpoint?.id ?? null)
    if (!key || lastKeyRef.current === key) return
    lastKeyRef.current = key
    form.reset(
      mode === 'create' || !endpoint
        ? createDefaults
        : endpointToValues(endpoint),
    )
  }, [open, mode, endpoint, form])

  const refresh = () => utils.webhooks.list.invalidate()
  const create = trpc.webhooks.create.useMutation({
    onSuccess: async (result) => {
      await refresh()
      onOpenChange(false)
      onSecret(result.secret)
    },
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const update = trpc.webhooks.update.useMutation({
    onSuccess: async () => {
      await refresh()
      onOpenChange(false)
    },
    onError: (error) =>
      toast({
        title: t('error'),
        description: error.message,
        variant: 'destructive',
      }),
  })
  const isPending = create.isPending || update.isPending

  const title =
    mode === 'create'
      ? t('createTitle')
      : mode === 'edit'
        ? t('editTitle')
        : t('viewTitle')

  async function handleSubmit(values: WebhookFormValues) {
    if (readOnly) return
    if (mode === 'create') {
      create.mutate({
        requestId: crypto.randomUUID(),
        name: values.name.trim(),
        url: values.url.trim(),
        enabled: values.enabled,
        events: values.events,
      })
    } else if (endpoint) {
      update.mutate({
        endpointId: endpoint.id,
        name: values.name.trim(),
        url: values.url.trim(),
        enabled: values.enabled,
        events: values.events,
      })
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return
        onOpenChange(next)
      }}
    >
      {open && (
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('description')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <Form {...form}>
            <form
              id="webhook-form"
              noValidate
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              <ResponsiveDialogBody className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('name')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('namePlaceholder')}
                          maxLength={80}
                          autoComplete="off"
                          disabled={readOnly || isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('url')}</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          inputMode="url"
                          placeholder="https://example.com/webhooks/spliit"
                          autoComplete="url"
                          spellCheck={false}
                          disabled={readOnly || isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>{t('urlHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <FormLabel>{t('enabledLabel')}</FormLabel>
                          <FormDescription>{t('enabledHint')}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={readOnly || isPending}
                            aria-label={t('enabledLabel')}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
                <fieldset
                  disabled={readOnly || isPending}
                  className="space-y-2"
                >
                  <legend className="text-sm font-medium">
                    {t('eventsLabel')}
                  </legend>
                  <div className="flex flex-col gap-2">
                    {(
                      [
                        ['created', t('eventsCreated')],
                        ['updated', t('eventsUpdated')],
                        ['deleted', t('eventsDeleted')],
                      ] as const
                    ).map(([key, label]) => (
                      <FormField
                        key={key}
                        control={form.control}
                        name={`events.${key}`}
                        render={({ field }) => (
                          <FormItem className="!mt-0">
                            <label
                              className={
                                readOnly || isPending
                                  ? 'flex cursor-not-allowed items-center gap-2.5'
                                  : 'flex cursor-pointer items-center gap-2.5'
                              }
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={(checked) =>
                                    field.onChange(checked === true)
                                  }
                                  disabled={readOnly || isPending}
                                  aria-label={label}
                                />
                              </FormControl>
                              <span
                                className={
                                  readOnly || isPending
                                    ? 'text-sm text-muted-foreground'
                                    : 'text-sm'
                                }
                              >
                                {label}
                              </span>
                            </label>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  {form.formState.errors.events?.message ? (
                    <p
                      role="alert"
                      className="text-sm font-medium text-destructive"
                    >
                      {t(form.formState.errors.events.message as never)}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {t('eventsHint')}
                  </p>
                </fieldset>
                <FormField
                  control={form.control}
                  name="events.involvedOnly"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <FormLabel>{t('involvedOnlyLabel')}</FormLabel>
                          <FormDescription>
                            {t('involvedOnlyHint')}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={readOnly || isPending}
                            aria-label={t('involvedOnlyLabel')}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
                {endpoint && mode !== 'create' ? (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {t('lastSuccess')}:{' '}
                      {endpoint.lastSuccessAt
                        ? new Date(endpoint.lastSuccessAt).toLocaleString()
                        : t('never')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('lastFailure')}:{' '}
                      {endpoint.lastFailureAt
                        ? new Date(endpoint.lastFailureAt).toLocaleString()
                        : t('never')}
                    </span>
                  </div>
                ) : null}
              </ResponsiveDialogBody>
            </form>
          </Form>
          <ResponsiveDialogFooter>
            {readOnly ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {t('close')}
                </Button>
                <Button type="button" onClick={onEdit}>
                  <Pencil className="me-2 size-4" />
                  {t('edit')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => onOpenChange(false)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  form="webhook-form"
                  disabled={isPending || (mode === 'edit' && !isDirty)}
                >
                  {mode === 'create' ? t('create') : t('save')}
                </Button>
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      )}
    </ResponsiveDialog>
  )
}
