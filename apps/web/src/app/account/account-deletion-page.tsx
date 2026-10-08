import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BanknoteCheck,
  Users,
  Loader2,
  User,
  UserRoundX,
  Coins,
  CheckCheck,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { PageShell, PageInset } from '@/components/layout/page-shell'
import { Money } from '@/components/money'
import { RequireAuth } from '@/components/require-auth'
import {
  TypedDestructiveConfirmation,
  isTypedConfirmationMatch,
  useTypedConfirmationValue,
} from '@/components/typed-destructive-confirmation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { getCurrencyFromGroup } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import { groupAccentStyle, GROUP_CARD_NEUTRAL } from '@/lib/group-appearance'
import {
  getPasskeySessionFreshness,
  signOutAndReturnToSignIn,
} from '@/lib/passkey'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { displayEmoji } from '@spliit/domain'

import { ScheduledDeletion } from './account-deletion-settings'

type DeletionErrorKey =
  | 'generic'
  | 'emailMismatch'
  | 'alreadyRequested'
  | 'sessionNotFresh'
  | 'jobsDisabled'
  | 'invalidDisplayName'

/**
 * Map a tRPC rejection to a stable i18n key. The server sends English technical
 * messages, so match on the transport code plus a message fragment rather than
 * the full text.
 */
function toErrorKey(error: unknown): DeletionErrorKey {
  const data = (error as { data?: { code?: string } } | null)?.data
  const message = error instanceof Error ? error.message : ''
  if (data?.code === 'PRECONDITION_FAILED') {
    // Incomplete guest accounts hit the onboarding gate, not a stale
    // session — surface the generic error instead of the re-auth flow.
    if (/ANONYMOUS_SETUP_REQUIRED/i.test(message)) return 'generic'
    return 'sessionNotFresh'
  }
  if (data?.code === 'SERVICE_UNAVAILABLE') return 'jobsDisabled'
  if (/typed email does not match/i.test(message)) return 'emailMismatch'
  if (/already pending/i.test(message)) return 'alreadyRequested'
  if (/between 1 and 100 characters/i.test(message)) return 'invalidDisplayName'
  return 'generic'
}

function ChoiceHeader({
  icon: Icon,
  selected,
  title,
  descriptionId,
  children,
}: {
  icon: LucideIcon
  selected: boolean
  title: string
  descriptionId: string
  children: React.ReactNode
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md',
          selected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-medium">{title}</span>
        <span
          id={descriptionId}
          className="mt-0.5 block text-xs leading-snug text-muted-foreground"
        >
          {children}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          selected
            ? 'border-primary bg-primary'
            : 'border-border bg-background group-hover:border-foreground/30',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full bg-background transition-opacity',
            selected ? 'opacity-100' : 'opacity-0',
          )}
        />
      </span>
    </>
  )
}

type GroupOutcome = 'deleted' | 'settled' | 'left'

export function AccountDeletionPage() {
  return (
    <RequireAuth>
      <AccountDeletionReview />
    </RequireAuth>
  )
}

function AccountDeletionReview() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  const { toast } = useToast()
  const deployment = useDeploymentConfig()
  const utils = trpc.useUtils()
  const [fresh, setFresh] = useState<boolean | null>(null)
  const [reauthPending, setReauthPending] = useState(false)
  const [keepName, setKeepName] = useState(true)
  const [customName, setCustomName] = useState<string | null>(null)
  const [settle, setSettle] = useState(false)
  const [acked, setAcked] = useState(false)
  const [error, setError] = useState<DeletionErrorKey | null>(null)
  const [nameError, setNameError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const scheduleButtonRef = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false)
  const [generation, setGeneration] = useState(0)
  const status = trpc.account.deletionStatus.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.request ? 5000 : false),
  })
  const pendingRequest = status.data?.request
  const previewQuery = trpc.account.deletionPreview.useQuery(undefined, {
    enabled: status.isSuccess && !pendingRequest && fresh === true,
  })
  const overviewQuery = trpc.overview.get.useQuery(undefined, {
    enabled: status.isSuccess && !pendingRequest && fresh === true,
  })
  const preview = previewQuery.data
  const [confirmation, setConfirmation] = useTypedConfirmationValue(
    `${generation}:${preview?.email ?? ''}:${fresh}:${dialogOpen}`,
  )
  useEffect(() => {
    let active = true
    void getPasskeySessionFreshness(deployment.passkeyFreshAgeSeconds).then(
      (value) => {
        if (active) setFresh(value)
      },
    )
    return () => {
      active = false
    }
  }, [deployment.passkeyFreshAgeSeconds])

  function resetReview() {
    setDialogOpen(false)
    setConfirmation('')
    setKeepName(true)
    setCustomName(null)
    setSettle(false)
    setAcked(false)
    setError(null)
    setNameError(false)
    setGeneration((value) => value + 1)
  }
  const request = trpc.account.requestDeletion.useMutation({
    onSuccess: async () => {
      await utils.account.deletionStatus.invalidate()
      await utils.account.deletionPreview.invalidate()
      submitting.current = false
      resetReview()
      toast({ description: t('scheduled') })
    },
    onError: (cause: unknown) => {
      submitting.current = false
      const key = toErrorKey(cause)
      if (key === 'sessionNotFresh') {
        setDialogOpen(false)
        setFresh(false)
        setConfirmation('')
        return
      }
      if (key === 'alreadyRequested') {
        setDialogOpen(false)
        void utils.account.deletionStatus.invalidate()
      }
      if (key === 'invalidDisplayName') {
        setNameError(true)
        setDialogOpen(false)
      } else setError(key)
    },
  })
  const canReview =
    !!preview &&
    acked &&
    fresh === true &&
    !status.isError &&
    !status.isPending &&
    !previewQuery.isPending &&
    !pendingRequest &&
    !previewQuery.isError &&
    !request.isPending

  function validateName() {
    const name = (customName ?? preview?.displayName ?? '').trim()
    if (keepName && (!name || name.length > 100)) {
      setNameError(true)
      nameInputRef.current?.focus()
      return false
    }
    setNameError(false)
    return true
  }
  function openConfirmation() {
    if (!canReview || submitting.current || !validateName()) return
    setError(null)
    setConfirmation('')
    setDialogOpen(true)
  }
  function changeDialogOpen(next: boolean) {
    if (request.isPending || submitting.current) return
    setDialogOpen(next)
    setConfirmation('')
    setError(null)
  }
  function schedule() {
    if (
      submitting.current ||
      !dialogOpen ||
      request.isPending ||
      !preview ||
      !acked ||
      fresh !== true ||
      status.isError ||
      status.isPending ||
      previewQuery.isPending ||
      pendingRequest ||
      previewQuery.isError ||
      !isTypedConfirmationMatch(confirmation, t('confirmWord'))
    )
      return
    if (!validateName()) {
      setDialogOpen(false)
      return
    }
    const name = (customName ?? preview.displayName).trim()
    setError(null)
    submitting.current = true
    request.mutate({
      email: preview.email,
      keepDisplayName: keepName,
      displayName: keepName ? name : undefined,
      settleBalances: settle,
    })
  }
  async function reauthenticate() {
    if (reauthPending) return
    setReauthPending(true)
    try {
      await signOutAndReturnToSignIn()
    } catch {
      setReauthPending(false)
      setError('generic')
    }
  }
  const loading = status.isPending || (!pendingRequest && fresh === null)
  return (
    <PageShell className="flex-col gap-8 py-6 sm:py-8">
      <PageInset>
        <Link
          to="/account/settings"
          hash="account-deletion"
          className={cn(buttonVariants({ variant: 'ghost' }), '-ms-3')}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t('backToSettings')}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {t('pageTitle')}
        </h1>
        {pendingRequest?.status !== 'EXECUTING' && (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('pageDescription')}
            </p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              <Trans
                i18nKey="AccountSettings.deletion.farewellBody"
                components={{
                  feedbackLink: (
                    <Link
                      to="/feedback"
                      className="underline underline-offset-2"
                    />
                  ),
                }}
              />
            </p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              <Trans
                i18nKey="AccountSettings.deletion.exportHint"
                components={{
                  exportLink: (
                    <Link
                      to="/account/settings"
                      hash="account-export"
                      className="underline underline-offset-2"
                    />
                  ),
                }}
              />
            </p>
          </>
        )}
      </PageInset>
      {status.isError ? (
        <LoadFailure onRetry={() => void status.refetch()} />
      ) : loading ? (
        <Loader2
          aria-label={t('loading')}
          className="mx-auto size-6 animate-spin"
        />
      ) : pendingRequest ? (
        <PageInset>
          <ScheduledDeletion
            request={pendingRequest}
            onCancelled={resetReview}
          />
        </PageInset>
      ) : fresh === false ? (
        <PageInset>
          <h2 className="text-lg font-semibold">{t('reauthTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('reauthDescription')}
          </p>
          <Button
            className="mt-4"
            disabled={reauthPending}
            onClick={() => void reauthenticate()}
          >
            {reauthPending && <Loader2 className="size-4 animate-spin" />}
            {t('reauthConfirm')}
          </Button>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
        </PageInset>
      ) : previewQuery.isError ? (
        <LoadFailure onRetry={() => void previewQuery.refetch()} />
      ) : !preview ? (
        <Loader2
          aria-label={t('loading')}
          className="mx-auto size-6 animate-spin"
        />
      ) : (
        <PageInset className="space-y-8">
          <fieldset disabled={request.isPending} className="min-w-0 space-y-10">
            <section aria-labelledby="deletion-choices">
              <h2
                id="deletion-choices"
                className="text-xl font-semibold tracking-tight"
              >
                {t('reviewChoicesTitle')}
              </h2>
              <h3 id="deletion-name" className="mt-6 text-base font-medium">
                {t('nameTitle')}
              </h3>
              <RadioGroup
                aria-labelledby="deletion-name"
                className="mt-3"
                disabled={request.isPending}
                value={keepName ? 'keep' : 'remove'}
                onValueChange={(value) => setKeepName(value === 'keep')}
              >
                <RadioGroupItem
                  card
                  value="keep"
                  aria-label={t('keepNameLabel')}
                  aria-describedby="kept-name-description"
                  content={
                    keepName ? (
                      <div className="space-y-2">
                        <Label htmlFor="account-deletion-custom-name">
                          {t('customNameLabel')}
                        </Label>
                        <Input
                          ref={nameInputRef}
                          id="account-deletion-custom-name"
                          value={customName ?? preview.displayName}
                          maxLength={100}
                          aria-invalid={nameError}
                          aria-describedby={
                            nameError ? 'deletion-name-error' : undefined
                          }
                          onChange={(event) => {
                            setCustomName(event.target.value)
                            setNameError(false)
                          }}
                        />
                        {nameError && (
                          <p
                            id="deletion-name-error"
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {t('errors.invalidDisplayName')}
                          </p>
                        )}
                      </div>
                    ) : undefined
                  }
                >
                  <ChoiceHeader
                    icon={User}
                    selected={keepName}
                    title={t('keepNameLabel')}
                    descriptionId="kept-name-description"
                  >
                    {t('keptNameExplanation', {
                      name: (customName ?? preview.displayName).trim(),
                    })}
                  </ChoiceHeader>
                </RadioGroupItem>
                <RadioGroupItem
                  card
                  value="remove"
                  aria-label={t('removeNameLabel')}
                  aria-describedby="removed-name-description"
                >
                  <ChoiceHeader
                    icon={UserRoundX}
                    selected={!keepName}
                    title={t('removeNameLabel')}
                    descriptionId="removed-name-description"
                  >
                    {t('removedNameExplanation')}
                  </ChoiceHeader>
                </RadioGroupItem>
              </RadioGroup>
              <h3 id="deletion-balances" className="mt-8 text-base font-medium">
                {t('balancesTitle')}
              </h3>
              <RadioGroup
                aria-labelledby="deletion-balances"
                className="mt-3"
                disabled={request.isPending}
                value={settle ? 'settle' : 'keep'}
                onValueChange={(value) => setSettle(value === 'settle')}
              >
                <RadioGroupItem
                  card
                  value="keep"
                  aria-label={t('keepBalancesLabel')}
                  aria-describedby="kept-balances-description"
                >
                  <ChoiceHeader
                    icon={Coins}
                    selected={!settle}
                    title={t('keepBalancesLabel')}
                    descriptionId="kept-balances-description"
                  >
                    {t('keptBalancesExplanation')}
                  </ChoiceHeader>
                </RadioGroupItem>
                <RadioGroupItem
                  card
                  value="settle"
                  aria-label={t('settleLabel')}
                  aria-describedby="settled-balances-description"
                >
                  <ChoiceHeader
                    icon={CheckCheck}
                    selected={settle}
                    title={t('settleLabel')}
                    descriptionId="settled-balances-description"
                  >
                    {t('settledBalancesExplanation')}
                  </ChoiceHeader>
                </RadioGroupItem>
              </RadioGroup>
            </section>
            <section
              aria-labelledby="deletion-consequences"
              className="space-y-6 border-t pt-8"
            >
              <h2
                id="deletion-consequences"
                className="text-xl font-semibold tracking-tight"
              >
                {t('consequencesTitle')}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {t('consequencesTiming')}
              </p>
              {preview.groups.length ? (
                <>
                  {overviewQuery.isPending && (
                    <output className="block text-sm text-muted-foreground">
                      {t('loading')}
                    </output>
                  )}
                  {overviewQuery.isError && (
                    <div>
                      <p role="alert" className="text-sm text-destructive">
                        {t('errors.loadFailed')}
                      </p>
                      <Button
                        variant="outline"
                        className="mt-2"
                        onClick={() => void overviewQuery.refetch()}
                      >
                        {t('retry')}
                      </Button>
                    </div>
                  )}
                  <GroupSections
                    groups={preview.groups}
                    settle={settle}
                    overview={overviewQuery.data?.groups ?? []}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noGroups')}</p>
              )}
              {(preview.signInMethods.length > 0 ||
                preview.pendingSentInvitations > 0) && (
                <AccessSection
                  methods={preview.signInMethods}
                  pendingInvitations={preview.pendingSentInvitations}
                />
              )}
            </section>
            <section
              aria-labelledby="deletion-confirmation"
              className="space-y-6 rounded-lg border bg-muted/30 p-5 sm:p-6"
            >
              <h2
                id="deletion-confirmation"
                className="text-xl font-semibold tracking-tight"
              >
                {t('reviewConfirmTitle')}
              </h2>
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-1"
                  disabled={request.isPending}
                  id="account-deletion-ack"
                  checked={acked}
                  onCheckedChange={(value) => setAcked(value === true)}
                />
                <Label
                  htmlFor="account-deletion-ack"
                  className="cursor-pointer text-sm leading-6 font-normal"
                >
                  {t('ackLabel')}
                </Label>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Link
                  to="/account/settings"
                  hash="account-deletion"
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    request.isPending && 'pointer-events-none opacity-50',
                  )}
                  aria-disabled={request.isPending || undefined}
                  tabIndex={request.isPending ? -1 : undefined}
                  onClick={(event) => {
                    if (request.isPending) event.preventDefault()
                  }}
                >
                  {t('dialogCancel')}
                </Link>
                <Button
                  variant="destructive"
                  ref={scheduleButtonRef}
                  disabled={!canReview}
                  onClick={openConfirmation}
                >
                  {request.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {request.isPending ? t('scheduling') : t('schedule')}
                </Button>
              </div>
            </section>
          </fieldset>
          <ResponsiveDialog
            open={
              dialogOpen &&
              !!preview &&
              fresh === true &&
              !pendingRequest &&
              !status.isError &&
              !previewQuery.isError
            }
            onOpenChange={changeDialogOpen}
          >
            <ResponsiveDialogContent
              className="max-w-lg"
              initialFocus={() =>
                document.getElementById('account-deletion-confirmation')
              }
              finalFocus={() =>
                nameError ? nameInputRef.current : scheduleButtonRef.current
              }
            >
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  {t('dialogTitle')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('dialogDescription')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="space-y-4">
                <TypedDestructiveConfirmation
                  id="account-deletion-confirmation"
                  kind="deleteAccount"
                  targetName={t('confirmWord')}
                  value={confirmation}
                  onValueChange={setConfirmation}
                  disabled={request.isPending}
                  onConfirm={schedule}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(`errors.${error}`)}
                  </p>
                )}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                <Button
                  variant="ghost"
                  disabled={request.isPending}
                  onClick={() => changeDialogOpen(false)}
                >
                  {t('dialogCancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={schedule}
                  disabled={
                    !canReview ||
                    !isTypedConfirmationMatch(confirmation, t('confirmWord'))
                  }
                >
                  {request.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {request.isPending ? t('scheduling') : t('schedule')}
                </Button>
              </ResponsiveDialogFooter>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </PageInset>
      )}
    </PageShell>
  )
}
function LoadFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  return (
    <PageInset>
      <p role="alert" className="text-sm text-destructive">
        {t('errors.loadFailed')}
      </p>
      <Button variant="outline" className="mt-3" onClick={onRetry}>
        {t('retry')}
      </Button>
    </PageInset>
  )
}

type OverviewGroup = AppRouterOutput['overview']['get']['groups'][number]

type PreviewGroup = {
  groupId: string
  name: string
  groupType: 'GROUP' | 'FRIEND'
  isLastAdmin: boolean
  isLastActiveMember: boolean
  hasUnsettledBalance: boolean
  willDeleteGroup: boolean
}

/** Group outcomes remain visible throughout the review. */
function GroupSections({
  groups,
  settle,
  overview,
}: {
  groups: PreviewGroup[]
  settle: boolean
  overview: OverviewGroup[]
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })

  const toDelete = groups.filter((group) => group.willDeleteGroup)
  const toLeave = groups.filter(
    (group) => !group.willDeleteGroup && group.groupType !== 'FRIEND',
  )
  const toSettle = groups.filter(
    (group) => !group.willDeleteGroup && group.groupType === 'FRIEND',
  )

  return (
    <div className="flex flex-col gap-6">
      <GroupSection
        outcome="deleted"
        title={t('groupsToDeleteTitle')}
        description={t('groupsToDeleteDescription')}
        groups={toDelete}
        settle={settle}
        overview={overview}
      />
      <GroupSection
        outcome="left"
        title={t('groupsToLeaveTitle')}
        description={t('groupsToLeaveDescription')}
        groups={toLeave}
        settle={settle}
        overview={overview}
      />
      <GroupSection
        outcome="settled"
        title={t('friendsTitle')}
        description={t('friendsDescription')}
        groups={toSettle}
        settle={settle}
        overview={overview}
      />
    </div>
  )
}

function GroupSection({
  outcome,
  title,
  description,
  groups,
  settle,
  overview,
}: {
  outcome: GroupOutcome
  title: string
  description: string
  groups: PreviewGroup[]
  settle: boolean
  overview: OverviewGroup[]
}) {
  const destructive = outcome === 'deleted'
  if (groups.length === 0) return null
  return (
    <section className="space-y-3">
      <h3
        className={cn(
          'flex items-center justify-between gap-3 text-base font-semibold',
          destructive && 'text-destructive',
        )}
      >
        {title}{' '}
        <span className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium tabular-nums">
          {groups.length}
        </span>
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      <ul className="space-y-3">
        {groups.map((group) => (
          <GroupRow
            key={group.groupId}
            group={group}
            settle={settle}
            overview={overview.find(
              (item) => item.id === group.groupId && item.access === 'MEMBER',
            )}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * Preview controls inclusion and outcomes; overview supplies identity and
 * balances.
 */
function GroupRow({
  group,
  settle,
  overview,
}: {
  group: PreviewGroup
  settle: boolean
  overview?: OverviewGroup
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  const { t: tOverview } = useTranslation(undefined, {
    keyPrefix: 'Homepage.overview',
  })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tBalances } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const accent = groupAccentStyle(overview?.color)
  const emoji = displayEmoji(overview?.emoji)
  const isFriend = group.groupType === 'FRIEND'
  const balance = overview?.financialSummary.netBalance
  const details: string[] = []
  if (!group.willDeleteGroup) {
    if (overview && group.groupType === 'FRIEND') {
      details.push(t(settle ? 'friendSettled' : 'friendKept'))
    } else if (overview && group.hasUnsettledBalance) {
      details.push(t(settle ? 'rowBalancesSettled' : 'rowBalancesKept'))
    }
    if (group.isLastAdmin) details.push(t('rowAdmin'))
  }
  return (
    <li
      className={cn(
        'relative flex min-w-0 overflow-hidden rounded-lg border bg-card shadow-xs',
        accent ? 'group-accent-card' : GROUP_CARD_NEUTRAL,
      )}
      style={accent ?? undefined}
    >
      {(isFriend || emoji) && (
        <span
          aria-hidden="true"
          className={cn(
            'grid w-12 shrink-0 place-items-center self-stretch',
            accent
              ? 'group-accent-rail'
              : 'border-e border-border/60 bg-muted/30',
          )}
        >
          {isFriend ? (
            overview?.friendAccount ? (
              <AccountAvatar account={overview.friendAccount} size="lg" />
            ) : (
              <Users className="size-4 text-muted-foreground" />
            )
          ) : (
            <span className="text-2xl leading-none">{emoji}</span>
          )}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1 py-3 ps-3 pe-4 break-words">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/groups/$groupId"
            params={{ groupId: group.groupId }}
            className="min-w-0 text-base leading-6 font-medium text-foreground no-underline underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {group.name || t('friendLedgerFallback')}
          </Link>
          {overview?.preference.hidden && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {tGroups('hidden')}
            </span>
          )}
          {overview?.archived && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {tGroups('archivedBadge')}
            </span>
          )}
        </div>
        <p
          className={cn(
            'flex items-start gap-1 text-sm leading-6',
            balance == null || balance === 0
              ? 'text-muted-foreground'
              : balance < 0
                ? 'text-destructive'
                : 'text-green-600 dark:text-green-400',
          )}
        >
          {balance == null || !overview ? (
            t('balanceUnavailable')
          ) : balance === 0 ? (
            <>
              <BanknoteCheck className="mt-1 size-3.5 shrink-0" aria-hidden />
              <span>{tBalances('direction.settledUp')}</span>
            </>
          ) : (
            <>
              {balance < 0 ? (
                <BanknoteArrowUp
                  className="mt-1 size-3.5 shrink-0"
                  aria-hidden
                />
              ) : (
                <BanknoteArrowDown
                  className="mt-1 size-3.5 shrink-0"
                  aria-hidden
                />
              )}
              <span className="font-medium">
                {tOverview(balance < 0 ? 'youOwe' : 'youAreOwed')}{' '}
                <Money
                  currency={getCurrencyFromGroup(overview.ledger)}
                  amount={Math.abs(balance)}
                />
              </span>
            </>
          )}
        </p>
        {details.map((detail) => (
          <p key={detail} className="text-sm leading-6 text-muted-foreground">
            {detail}
          </p>
        ))}
      </div>
    </li>
  )
}

function AccessSection({
  methods,
  pendingInvitations,
}: {
  methods: string[]
  pendingInvitations: number
}) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  const methodNames = new Intl.ListFormat(
    i18n.resolvedLanguage ?? i18n.language,
    { style: 'long', type: 'conjunction' },
  ).format(methods)
  return (
    <section className="space-y-1">
      <h3 className="text-base font-semibold">{t('accessTitle')}</h3>
      {methods.length > 0 && (
        <p className="text-sm leading-6 text-muted-foreground">
          {t('signInMethodsRemoved', { methods: methodNames })}
        </p>
      )}
      {pendingInvitations > 0 && (
        <p className="text-sm leading-6 text-muted-foreground">
          {t('pendingInvites', { count: pendingInvitations })}
        </p>
      )}
    </section>
  )
}
