import { QrCode } from 'lucide-react'
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { trpc } from '@/trpc/client'

import {
  type PendingInvitation,
  type QrSession,
  type QrSessionJoiner,
  createQrSession,
} from './members-hooks'

function expiresAtMs(value: Date | string): number {
  return (typeof value === 'string' ? new Date(value) : value).getTime()
}

// The QR renderer stays out of the members-page bundle: it only loads when
// a code is actually shown (the scanner lib is likewise dynamically
// imported inside the scan dialog).
const QRCodeSVG = lazy(() =>
  import('qrcode.react').then((module) => ({ default: module.QRCodeSVG })),
)

/**
 * How long a freshly created session is trusted before the invitation list must
 * confirm it. Covers the poll lag after create; anything older that the list
 * does not contain is dead (revoked elsewhere, expired, or full).
 */
const QR_SESSION_CONFIRM_GRACE_MS = 10_000

/**
 * Chunk-load failure (offline CDN hiccup) must not wedge the tab on a Skeleton
 * forever: offer a retry that remounts the lazy renderer.
 */
class QrRendererBoundary extends Component<
  { children: ReactNode; onRetry: () => void; retryLabel: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex size-[220px] flex-col items-center justify-center gap-2 rounded-md bg-neutral-200">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ failed: false })
              this.props.onRetry()
            }}
          >
            {this.props.retryLabel}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

function isInvitationExpired(invitation: PendingInvitation): boolean {
  return (
    !!invitation.expiresAt &&
    new Date(invitation.expiresAt).getTime() < Date.now()
  )
}

/**
 * Names of the accounts that already joined this QR session, oldest first.
 * Shared by the QR tab (full list) — the pending card renders a compact
 * one-line variant inline.
 */
export function QrJoinersList({ joiners }: { joiners: QrSessionJoiner[] }) {
  if (joiners.length === 0) return null
  return (
    <ul
      className="flex max-h-40 w-full flex-col gap-1 overflow-y-auto"
      data-testid="qr-invite-joiners"
    >
      {joiners.map((joiner) => (
        <li key={joiner.accountId} className="flex items-center gap-2 text-sm">
          <AccountAvatar
            account={{
              id: joiner.accountId,
              name: joiner.name,
              image: joiner.image,
            }}
            size="sm"
            className="shrink-0"
          />
          <span className="min-w-0 truncate">
            {joiner.name ?? joiner.accountId}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Top-level multi-use QR / nearby session tab. One 15-minute code the whole
 * room can scan — scan-only, the URL never leaves this screen. Only one session
 * is live per group: when another browser or admin already started one, this
 * tab resumes it (summary + take over) instead of minting a parallel code.
 * Sessions are always MEMBER-level (enforced server-side): a forwarded
 * screenshot can never mint an outside admin.
 */
export function InviteQrTab({
  groupId,
  session,
  onSessionChange,
}: {
  groupId: string
  session: QrSession | null
  onSessionChange: (session: QrSession | null) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [rendererKey, setRendererKey] = useState(0)
  const createAttempt = useIdempotentCreate()
  const utils = trpc.useUtils()

  const createQrLinkMutation = trpc.invitations.createQrLink.useMutation({
    onSuccess: async () => {
      await utils.invitations.list.invalidate({ groupId })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
      // A CONFLICT means someone else started a session first — refresh so
      // the tab converges on the summary view instead of the empty state.
      void utils.invitations.list.invalidate({ groupId })
    },
  })

  const revokeMutation = trpc.invitations.revoke.useMutation({
    onSuccess: async () => {
      toast({ description: t('invite.qr.stopped') })
      onSessionChange(null)
      await utils.invitations.list.invalidate({ groupId })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
      // The session may already be dead server-side (revoked elsewhere):
      // refresh so the tab converges instead of showing a zombie code.
      void utils.invitations.list.invalidate({ groupId })
    },
  })

  // Takeover revokes without the "stopped" side effects: the replacement
  // code (or the convergence back to the summary) is the feedback. If the
  // follow-up create loses a race, the create error toast + invalidation
  // land the tab on the winner's summary.
  const takeOverMutation = trpc.invitations.revoke.useMutation({
    onSuccess: async () => {
      await utils.invitations.list.invalidate({ groupId })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  // Live session state + joiners while this tab is mounted.
  const invitationsQuery = trpc.invitations.list.useQuery(
    { groupId },
    { refetchInterval: 5000, refetchOnWindowFocus: true },
  )
  const activeSession =
    invitationsQuery.data?.invitations.find(
      (invitation) =>
        invitation.type === 'LINK' &&
        invitation.isMultiUse &&
        !isInvitationExpired(invitation),
    ) ?? null

  const showingOwnCode =
    session !== null &&
    (activeSession === null || activeSession.id === session.invitationId)
  const summarySession =
    !showingOwnCode && activeSession !== null ? activeSession : null

  // Our local session ended elsewhere (revoked, expired, taken over, or
  // full): drop it so the tab falls through to the summary / empty state.
  // A freshly created session is trusted for one grace window — the list
  // lags one refetch behind the mutation — but anything older that the
  // list does not contain is dead. `createdAt` is what makes a reload after
  // a remote revoke converge instead of resurrecting a zombie code; legacy
  // stored sessions without it read as age-infinite and clear immediately.
  const seenLiveById = useRef(new Map<string, boolean>())
  useEffect(() => {
    if (session === null || !invitationsQuery.data) return
    const live = invitationsQuery.data.invitations.some(
      (invitation) =>
        invitation.id === session.invitationId &&
        invitation.type === 'LINK' &&
        invitation.isMultiUse &&
        !isInvitationExpired(invitation),
    )
    if (live) {
      seenLiveById.current.set(session.invitationId, true)
      return
    }
    if (Date.now() - (session.createdAt ?? 0) > QR_SESSION_CONFIRM_GRACE_MS) {
      seenLiveById.current.delete(session.invitationId)
      onSessionChange(null)
    }
    // `now` ticks must not clear anything — only fresh list data can.
  }, [invitationsQuery.data, session, onSessionChange])

  // Tick the countdown clock while the tab is mounted. The list query
  // polls on the same cadence, so expiry and joiners stay in sync.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const matchedActive =
    showingOwnCode &&
    session !== null &&
    activeSession?.id === session.invitationId
      ? activeSession
      : null
  const joiners = matchedActive?.recentJoiners ?? []
  const joinedCount = matchedActive?.useCount ?? 0
  const codeExpiresAt = session?.expiresAt ?? null
  const codeMinutesLeft = codeExpiresAt
    ? Math.max(0, Math.ceil((expiresAtMs(codeExpiresAt) - now) / 60000))
    : 0
  const summaryJoiners = summarySession?.recentJoiners ?? []
  const summaryCount = summarySession?.useCount ?? 0
  const summaryExpiresAt = summarySession?.expiresAt ?? null
  const summaryMinutesLeft = summaryExpiresAt
    ? Math.max(0, Math.ceil((expiresAtMs(summaryExpiresAt) - now) / 60000))
    : 0

  async function handleShowQr() {
    const result = await createAttempt.run((requestId) =>
      createQrLinkMutation.mutateAsync({
        groupId,
        role: 'MEMBER',
        requestId,
      }),
    )
    if (result) {
      onSessionChange(
        createQrSession({
          invitationId: result.invitationId,
          inviteUrl: result.inviteUrl,
          expiresAt: result.expiresAt,
        }),
      )
    }
  }

  async function handleTakeOver() {
    if (!summarySession) return
    try {
      await takeOverMutation.mutateAsync({
        invitationId: summarySession.id,
      })
    } catch {
      // The mutation already toasted the failure; keep the old summary.
      return
    }
    await handleShowQr()
  }

  return (
    <>
      <p className="border-s-2 border-primary/40 ps-3 text-sm text-muted-foreground">
        {t('invite.qr.description')}
      </p>

      {showingOwnCode && session ? (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-lg bg-white p-4" data-testid="qr-invite-code">
            <QrRendererBoundary
              key={rendererKey}
              retryLabel={t('invite.qr.retry')}
              onRetry={() => setRendererKey((key) => key + 1)}
            >
              <Suspense
                fallback={
                  <Skeleton className="size-[220px] rounded-md bg-neutral-200" />
                }
              >
                <QRCodeSVG
                  value={session.inviteUrl}
                  size={220}
                  level="M"
                  aria-label={t('invite.qr.title')}
                />
              </Suspense>
            </QrRendererBoundary>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('invite.qr.multiUse')}{' '}
            {codeMinutesLeft > 1
              ? t('invite.qr.expiresIn', { count: codeMinutesLeft })
              : t('invite.qr.expiringSoon')}
          </p>
          <p
            className="text-sm font-medium"
            data-testid="qr-invite-joined-count"
          >
            {t('invite.qr.joined', { count: joinedCount })}
          </p>
          <QrJoinersList joiners={joiners} />
          <Button
            type="button"
            variant="outline"
            disabled={revokeMutation.isPending}
            onClick={() =>
              void revokeMutation.mutateAsync({
                invitationId: session.invitationId,
              })
            }
          >
            {t('invite.qr.stop')}
          </Button>
        </div>
      ) : summarySession ? (
        <div className="flex flex-col items-center gap-3">
          <p
            className="border-s-2 border-amber-500/50 ps-3 text-sm text-amber-900 dark:text-amber-200"
            role="note"
          >
            {t('invite.qr.alreadyActive')}
          </p>
          <p className="text-sm text-muted-foreground">
            {summaryMinutesLeft > 1
              ? t('invite.qr.expiresIn', { count: summaryMinutesLeft })
              : t('invite.qr.expiringSoon')}
          </p>
          <p
            className="text-sm font-medium"
            data-testid="qr-invite-joined-count"
          >
            {t('invite.qr.joined', { count: summaryCount })}
          </p>
          <QrJoinersList joiners={summaryJoiners} />
          {summarySession.canRevoke ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                disabled={
                  takeOverMutation.isPending || createQrLinkMutation.isPending
                }
                onClick={() => void handleTakeOver()}
              >
                <QrCode className="me-2 h-4 w-4" />
                {t('invite.qr.takeOver')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={revokeMutation.isPending}
                onClick={() =>
                  void revokeMutation.mutateAsync({
                    invitationId: summarySession.id,
                  })
                }
              >
                {t('invite.qr.stop')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('invite.qr.activeElsewhere')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-stretch gap-2">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              disabled={createQrLinkMutation.isPending}
              onClick={() => void handleShowQr()}
            >
              <QrCode className="me-2 h-4 w-4" />
              {createQrLinkMutation.isPending
                ? t('invite.qr.generating')
                : t('invite.qr.show')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
