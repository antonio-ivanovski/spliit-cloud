import { Link2 } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'

import { GeneratedInviteLinkPanel } from './generated-invite-link-panel'
import {
  SHARED_LINK_DEFAULT_EXPIRY,
  SHARED_LINK_LABEL_MAX_LENGTH,
  formatDateTime,
  useRoleSelectItems,
  type GeneratedLink,
  type InvitableRole,
  type LinkFormValues,
  type SharedLinkExpiryUnit,
  type SharedLinkFormValues,
} from './members-hooks'
import { ExpiryPicker, JoinLimitPicker } from './shared-link-limit-pickers'

export function InviteLinkTab({
  linkForm,
  sharedForm,
  onSubmit,
  linkRoleValue,
  canInviteAdmin,
  onRoleChange,
  isPending,
  generatedLink,
  canShare,
  groupName,
  onShare,
  onModeChange,
}: {
  linkForm: UseFormReturn<LinkFormValues>
  sharedForm: UseFormReturn<SharedLinkFormValues>
  onSubmit: () => void
  linkRoleValue: InvitableRole
  canInviteAdmin: boolean
  onRoleChange: (value: InvitableRole) => void
  isPending: boolean
  generatedLink: GeneratedLink | null
  canShare: boolean
  groupName: string
  onShare: () => void
  /** Called when the one-time/shared mode changes (clears stale results). */
  onModeChange?: (mode: 'oneTime' | 'shared') => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const roleSelectItems = useRoleSelectItems()
  const mode = sharedForm.watch('mode')
  const isShared = mode === 'shared'
  return (
    <>
      <SharedLinkModeTabs form={sharedForm} onModeChange={onModeChange} />

      {isShared ? (
        <SharedLinkForm
          form={sharedForm}
          onSubmit={onSubmit}
          isPending={isPending}
          generatedLink={generatedLink}
        />
      ) : (
        <Form {...linkForm}>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t('invite.link.modeOneTimeHint')}
            </p>
            <FormField
              control={linkForm.control}
              name="temporaryName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('invite.temporaryName')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={t('invite.temporaryNamePlaceholder')}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              {canInviteAdmin && (
                <FormItem className="space-y-0 sm:w-40">
                  <FormLabel className="sm:sr-only">
                    {t('invite.role')}
                  </FormLabel>
                  <FormControl>
                    <Select
                      value={linkRoleValue}
                      items={roleSelectItems}
                      onValueChange={(value) =>
                        onRoleChange(value as InvitableRole)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleSelectItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
              )}
              <Button type="submit" disabled={isPending}>
                <Link2 className="me-2 h-4 w-4" />
                {isPending
                  ? t('invite.link.generating')
                  : generatedLink && !generatedLink.isShared
                    ? t('invite.link.generateNew')
                    : t('invite.link.generate')}
              </Button>
            </div>
          </form>
        </Form>
      )}

      {generatedLink && !generatedLink.isShared && !isShared && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t('invite.link.intro', { groupName })}
          </p>
          <p className="border-s-2 border-amber-500/50 ps-3 text-sm text-amber-900 dark:text-amber-200">
            {t('invite.link.singleUse')}
          </p>
          <GeneratedInviteLinkPanel
            inviteUrl={generatedLink.inviteUrl}
            expiresAt={generatedLink.expiresAt ?? new Date()}
            onShare={onShare}
            canShare={canShare}
          />
        </div>
      )}
    </>
  )
}

function SharedLinkModeTabs({
  form,
  onModeChange,
}: {
  form: UseFormReturn<SharedLinkFormValues>
  onModeChange?: (mode: 'oneTime' | 'shared') => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  // Rendered outside any <Form> (the one-time branch owns its own form), so
  // this is a controlled Tabs bound straight to the shared form value —
  // no FormField/FormItem (those require RHF context).
  const mode = form.watch('mode')
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t('invite.link.mode')}</span>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          const next = value as 'oneTime' | 'shared'
          form.setValue('mode', next)
          onModeChange?.(next)
        }}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="oneTime">
            {t('invite.link.modeOneTime')}
          </TabsTrigger>
          <TabsTrigger value="shared">
            {t('invite.link.modeShared')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

function SharedLinkForm({
  form,
  onSubmit,
  isPending,
  generatedLink,
}: {
  form: UseFormReturn<SharedLinkFormValues>
  onSubmit: () => void
  isPending: boolean
  generatedLink: GeneratedLink | null
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const maxUses = form.watch('maxUses')
  const expiresIn = form.watch('expiresIn')
  const expiryPreset = form.watch('expiryPreset')

  // Projected expiry from the selected duration, so the summary pins the
  // exact moment ("expires in 7 days (Oct 26, 2026, 2:30 PM)"). Only valid
  // durations project — a cleared Other input has no date to show, and
  // reads as an unfinished duration (never the never-expires line) so the
  // summary never contradicts the submit validation that rejects it.
  const isUnfinishedOther =
    expiryPreset === 'other' &&
    (expiresIn == null ||
      !Number.isInteger(expiresIn.amount) ||
      expiresIn.amount < 1)
  // An unfinished Other has no amount to echo: display falls back to the
  // seeded 7-day shape (the unit the select still shows), submit rejects.
  const displayExpiry =
    isUnfinishedOther && expiresIn == null
      ? { ...SHARED_LINK_DEFAULT_EXPIRY }
      : expiresIn
  const projectedExpiry =
    !isUnfinishedOther &&
    expiresIn &&
    Number.isInteger(expiresIn.amount) &&
    expiresIn.amount >= 1
      ? computeExpiryDate(expiresIn)
      : null
  const expiryDate = projectedExpiry
    ? formatDateTime(projectedExpiry, locale, accountTimeZone)
    : null

  const summary =
    expiresIn == null && !isUnfinishedOther
      ? maxUses == null
        ? t('invite.link.summaryUnlimited')
        : t('invite.link.summaryCappedNever', { maxUses })
      : maxUses == null
        ? expiryDate
          ? t('invite.link.summaryExpiryOnly', {
              expiry: formatExpiry(displayExpiry, t),
              expiryDate,
            })
          : t('invite.link.summaryExpiryOnlyNoDate', {
              expiry: formatExpiry(displayExpiry, t),
            })
        : expiryDate
          ? t('invite.link.summaryCapped', {
              maxUses,
              expiry: formatExpiry(displayExpiry, t),
              expiryDate,
            })
          : t('invite.link.summaryCappedNoDate', {
              maxUses,
              expiry: formatExpiry(displayExpiry, t),
            })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t('invite.link.modeSharedHint')}
        </p>
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('invite.link.labelLabel')}</FormLabel>
              <FormControl>
                <Input
                  className="text-base"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={SHARED_LINK_LABEL_MAX_LENGTH}
                  placeholder={t('invite.link.labelPlaceholder')}
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="maxUses"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <JoinLimitPicker
                    preset={form.watch('joinLimitPreset')}
                    onPresetChange={(preset) =>
                      form.setValue('joinLimitPreset', preset)
                    }
                    value={field.value}
                    onChange={field.onChange}
                    label={t('invite.link.joinLimitLabel')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="expiresIn"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <ExpiryPicker
                    preset={form.watch('expiryPreset')}
                    onPresetChange={(preset) =>
                      form.setValue('expiryPreset', preset)
                    }
                    value={field.value}
                    onChange={field.onChange}
                    label={t('invite.link.expiryLabel')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <p
          className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
          role="note"
        >
          {summary}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('invite.link.memberOnlyNote')}
        </p>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button type="submit" disabled={isPending}>
            <Link2 className="me-2 h-4 w-4" />
            {isPending
              ? t('invite.link.generating')
              : generatedLink?.isShared
                ? t('invite.link.generateNew')
                : t('invite.link.generate')}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/**
 * Projected absolute expiry for a save-now duration (same unit math as the
 * manage dialog's preview). Module-level so the clock read stays outside
 * compiled render scope.
 */
function computeExpiryDate(expiresIn: {
  amount: number
  unit: SharedLinkExpiryUnit
}): Date {
  return new Date(
    Date.now() +
      expiresIn.amount *
        (expiresIn.unit === 'hours'
          ? 60 * 60 * 1000
          : expiresIn.unit === 'days'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000),
  )
}

function formatExpiry(
  expiresIn: { amount: number; unit: SharedLinkExpiryUnit } | null,
  t: (key: string) => string,
): string {
  if (!expiresIn) return ''
  const unit =
    expiresIn.unit === 'hours'
      ? t('invite.link.expiryUnitHour')
      : expiresIn.unit === 'days'
        ? t('invite.link.expiryUnitDay')
        : t('invite.link.expiryUnitWeek')
  return `${expiresIn.amount} ${unit}`
}

export function SharedLinkResultPanel({
  generatedLink,
  canShare,
  groupName,
  onShare,
}: {
  generatedLink: GeneratedLink
  canShare: boolean
  groupName: string
  onShare: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  // The intro names the join count instead of "anyone": capped links bind
  // {maxUses}, unlimited links get their own variant (no phantom number).
  const intro =
    generatedLink.maxUses != null
      ? t('invite.link.sharedIntro', {
          groupName,
          maxUses: generatedLink.maxUses,
        })
      : t('invite.link.sharedIntroUnlimited', { groupName })
  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{intro}</p>
      <GeneratedInviteLinkPanel
        inviteUrl={generatedLink.inviteUrl}
        expiresAt={generatedLink.expiresAt}
        expiryLabel={
          generatedLink.expiresAt ? undefined : t('invite.link.neverExpires')
        }
        onShare={onShare}
        canShare={canShare}
      />
      <p className="border-s-2 border-primary/40 ps-3 text-sm text-muted-foreground">
        {t('invite.link.sharedCopyAgain')}
      </p>
    </div>
  )
}
