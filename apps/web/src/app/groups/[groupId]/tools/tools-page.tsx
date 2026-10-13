import { Link, useLocation } from '@tanstack/react-router'
import { ArrowLeftRight, FileSpreadsheet, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useCurrentGroupOrNull } from '@/app/groups/[groupId]/current-group-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useHashTargetFocus } from '@/lib/use-hash-target-focus'
import { useOnlineStatus } from '@/lib/use-online-status'

const IMPORT_STEPS = [
  {
    titleKey: 'Tools.import.steps.choose.title',
    detailKey: 'Tools.import.steps.choose.detail',
  },
  {
    titleKey: 'Tools.import.steps.map.title',
    detailKey: 'Tools.import.steps.map.detail',
  },
  {
    titleKey: 'Tools.import.steps.review.title',
    detailKey: 'Tools.import.steps.review.detail',
  },
] as const

const SWAP_STEPS = [
  {
    titleKey: 'Tools.swap.steps.target.title',
    detailKey: 'Tools.swap.steps.target.detail',
  },
  {
    titleKey: 'Tools.swap.steps.rates.title',
    detailKey: 'Tools.swap.steps.rates.detail',
  },
  {
    titleKey: 'Tools.swap.steps.review.title',
    detailKey: 'Tools.swap.steps.review.detail',
  },
  {
    titleKey: 'Tools.swap.steps.confirm.title',
    detailKey: 'Tools.swap.steps.confirm.detail',
  },
] as const

const CATEGORIZE_STEPS = [
  {
    titleKey: 'Tools.categorize.steps.choose.title',
    detailKey: 'Tools.categorize.steps.choose.detail',
  },
  {
    titleKey: 'Tools.categorize.steps.calibrate.title',
    detailKey: 'Tools.categorize.steps.calibrate.detail',
  },
  {
    titleKey: 'Tools.categorize.steps.review.title',
    detailKey: 'Tools.categorize.steps.review.detail',
  },
  {
    titleKey: 'Tools.categorize.steps.save.title',
    detailKey: 'Tools.categorize.steps.save.detail',
  },
] as const

export default function GroupToolsPage() {
  const { t } = useTranslation()
  // Keep the page usable in isolated renders as well as inside the group
  // layout; the optional context returns null when no provider is mounted.
  const groupContext = useCurrentGroupOrNull()
  const { group, groupId, viewer, currentInvitation, currentMember } =
    groupContext ?? {}
  const resolvedGroupId = groupId ?? ''
  const isOnline = useOnlineStatus()
  const { hash } = useLocation()
  useHashTargetFocus(hash)
  // Offline is read-only: import/AI require connection even for members.
  // Keep the page discoverable but disable actions with honest copy.
  const canMutate =
    Boolean(group) &&
    (viewer?.canMutate ?? !currentInvitation) &&
    !group?.archived &&
    isOnline

  return (
    <div className="mb-4 flex flex-col gap-4">
      <div className="px-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('Tools.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('Tools.description')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            {t('Tools.import.title')}
          </CardTitle>
          <CardDescription>{t('Tools.import.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="grid gap-3 text-sm">
            {IMPORT_STEPS.map((step, index) => (
              <li key={step.titleKey} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                >
                  {index + 1}
                </span>
                <p>
                  <span className="font-medium">{t(step.titleKey)}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {t(step.detailKey)}
                  </span>
                </p>
              </li>
            ))}
          </ol>
          <div className="space-y-2 border-t border-border/70 pt-5">
            <Button
              type="button"
              disabled={!canMutate}
              nativeButton={!canMutate || !resolvedGroupId}
              render={
                canMutate && resolvedGroupId ? (
                  <Link
                    to="/groups/$groupId/tools/import"
                    params={{ groupId: resolvedGroupId }}
                  />
                ) : undefined
              }
            >
              {t('Tools.import.start')}
            </Button>
            {!canMutate ? (
              <p className="text-xs text-muted-foreground">
                {!isOnline
                  ? t('OfflineReadOnly.reconnectToEdit')
                  : group?.archived
                    ? t('Tools.import.archivedNotice')
                    : t('Tools.import.readOnlyNotice')}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {currentMember?.role === 'ADMIN' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              {t('Tools.categorize.title')}
            </CardTitle>
            <CardDescription>
              {t('Tools.categorize.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="grid gap-3 text-sm">
              {CATEGORIZE_STEPS.map((step, index) => (
                <li key={step.titleKey} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {index + 1}
                  </span>
                  <p>
                    <span className="font-medium">{t(step.titleKey)}</span>
                    <span className="text-muted-foreground">
                      {' — '}
                      {t(step.detailKey)}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
            <div className="space-y-2 border-t border-border/70 pt-5">
              <Button
                type="button"
                disabled={!canMutate}
                nativeButton={!canMutate || !resolvedGroupId}
                render={
                  canMutate && resolvedGroupId ? (
                    <Link
                      to="/groups/bulk-categorize/$groupId"
                      params={{ groupId: resolvedGroupId }}
                    />
                  ) : undefined
                }
              >
                {t('Tools.categorize.start')}
              </Button>
              {!canMutate ? (
                <p className="text-xs text-muted-foreground">
                  {!isOnline
                    ? t('OfflineReadOnly.reconnectToEdit')
                    : group?.archived
                      ? t('Tools.import.archivedNotice')
                      : t('Tools.import.readOnlyNotice')}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
      {currentMember?.role === 'ADMIN' && (
        <Card id="tools-swap" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              {t('Tools.swap.title')}
            </CardTitle>
            <CardDescription>{t('Tools.swap.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="grid gap-3 text-sm">
              {SWAP_STEPS.map((step, index) => (
                <li key={step.titleKey} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {index + 1}
                  </span>
                  <p>
                    <span className="font-medium">{t(step.titleKey)}</span>
                    <span className="text-muted-foreground">
                      {' — '}
                      {t(step.detailKey)}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
            <div className="space-y-2 border-t border-border/70 pt-5">
              <Button
                type="button"
                disabled={!canMutate}
                nativeButton={!canMutate || !resolvedGroupId}
                render={
                  canMutate && resolvedGroupId ? (
                    <Link
                      to="/groups/$groupId/tools/swap"
                      params={{ groupId: resolvedGroupId }}
                    />
                  ) : undefined
                }
              >
                {t('Tools.swap.start')}
              </Button>
              {!canMutate ? (
                <p className="text-xs text-muted-foreground">
                  {!isOnline
                    ? t('OfflineReadOnly.reconnectToEdit')
                    : group?.archived
                      ? t('Tools.import.archivedNotice')
                      : t('Tools.import.readOnlyNotice')}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
