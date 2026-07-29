import { LoaderCircle, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { formatZonedDate } from '@/lib/utils'
import { trpc } from '@/trpc/client'

import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'

const MAX_COMMENT_LENGTH = 500

type ExpenseCommentsProps = {
  groupId: string
  expenseId: string
}

/**
 * Comments attached to an expense. Read access is available to every group
 * viewer; writing is reserved for accepted members of active groups.
 */
export function ExpenseComments({ groupId, expenseId }: ExpenseCommentsProps) {
  const { group, currentMember } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpensePreview' })
  const utils = trpc.useUtils()

  const commentsQuery = trpc.groups.expenses.comments.list.useQuery(
    { groupId, expenseId, linkInviteToken },
    { retry: false },
  )
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  )

  const createMutation = trpc.groups.expenses.comments.create.useMutation()
  const deleteMutation = trpc.groups.expenses.comments.delete.useMutation()

  const canComment = Boolean(
    group && !group.archived && !isPendingInvitee && currentMember,
  )

  const invalidateComments = async () => {
    await Promise.all([
      // Keep this input exact so only this expense's comment list is refreshed.
      utils.groups.expenses.comments.list.invalidate({
        groupId,
        expenseId,
        linkInviteToken,
      }),
      utils.groups.activities.list.invalidate({ groupId, linkInviteToken }),
    ])
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = draft.trim()
    if (!body) {
      setValidationError(t('commentRequired'))
      return
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      setValidationError(t('commentTooLong'))
      return
    }

    setValidationError(null)
    try {
      await createMutation.mutateAsync({
        groupId,
        expenseId,
        body,
      })
      setDraft('')
      await invalidateComments()
    } catch {
      // Keep the draft in place so a transient failure never loses a comment.
    }
  }

  const handleDelete = async (commentId: string) => {
    setDeletingCommentId(commentId)
    try {
      await deleteMutation.mutateAsync({ groupId, expenseId, commentId })
      await invalidateComments()
    } catch {
      // The mutation error is rendered below; the comment remains in the list.
    } finally {
      setDeletingCommentId(null)
    }
  }

  const queryData = commentsQuery.data as
    | { comments?: CommentItem[] }
    | CommentItem[]
    | undefined
  const comments = Array.isArray(queryData)
    ? queryData
    : (queryData?.comments ?? [])

  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-labelledby="expense-comments-title"
    >
      <h3
        id="expense-comments-title"
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {t('commentsTitle')}
      </h3>

      {commentsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('commentsLoading')}
        </p>
      ) : commentsQuery.error ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{t('commentsError')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void commentsQuery.refetch()}
          >
            {t('commentsRetry')}
          </Button>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('commentsEmpty')}</p>
      ) : (
        <ul className="space-y-3" aria-label={t('commentsTitle')}>
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              <AccountAvatar
                account={{
                  id: comment.author.accountId ?? `comment-${comment.id}`,
                  name: comment.author.name,
                  image: comment.author.image,
                }}
                size="sm"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1 rounded-lg bg-muted/40 px-3 py-2">
                <div className="flex items-start gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {comment.author.name}
                  </span>
                  <time
                    dateTime={new Date(comment.createdAt).toISOString()}
                    className="shrink-0 text-muted-foreground"
                  >
                    {formatZonedDate(
                      new Date(comment.createdAt),
                      locale,
                      accountTimeZone,
                    )}
                  </time>
                  {comment.canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="-mt-2 -mr-2 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={t('commentDelete')}
                      disabled={deletingCommentId === comment.id}
                      onClick={() => void handleDelete(comment.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <form className="space-y-2 pt-1" onSubmit={handleCreate}>
          <label htmlFor="expense-comment-input" className="sr-only">
            {t('commentInputLabel')}
          </label>
          <div className="flex min-h-10 w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <Input
              id="expense-comment-input"
              type="text"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                if (validationError) setValidationError(null)
              }}
              placeholder={t('commentPlaceholder')}
              maxLength={MAX_COMMENT_LENGTH}
              enterKeyHint="send"
              aria-describedby={
                validationError ? 'expense-comment-error' : undefined
              }
              aria-invalid={validationError ? true : undefined}
              disabled={createMutation.isPending}
              className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 py-1.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="m-0.5 h-8 w-8 shrink-0 rounded-sm"
              aria-label={
                createMutation.isPending
                  ? t('commentSubmitting')
                  : t('commentSend')
              }
              disabled={createMutation.isPending || draft.trim().length === 0}
            >
              {createMutation.isPending ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          {(validationError || createMutation.error) && (
            <p
              id="expense-comment-error"
              className="text-xs text-destructive"
              role="alert"
            >
              {validationError ?? createMutation.error?.message}
            </p>
          )}
        </form>
      )}

      {deleteMutation.error && (
        <p className="text-xs text-destructive" role="alert">
          {deleteMutation.error.message}
        </p>
      )}
    </section>
  )
}

type CommentItem = {
  id: string
  body: string
  createdAt: string | Date
  author: {
    accountId: string | null
    name: string
    image?: string | null
  }
  canDelete: boolean
}
