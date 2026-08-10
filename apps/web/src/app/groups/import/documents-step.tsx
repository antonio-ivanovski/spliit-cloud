import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { getApiBaseUrl } from '@/lib/api-url'
import { resizeImage } from '@/lib/upload'
import { trpc } from '@/trpc/client'
import type { NormalizedSource } from '@spliit/domain/import'

import { WizardNav } from './wizard-nav'

const MAX_FILE_SIZE = 2 * 1024 ** 2

type Failure = {
  expenseTitle: string
  documentCount: number
  message: string
}

type RecoveryState = {
  stagedTokens: string[]
  recoveredCount: number
  failures: Failure[]
}

type Props = {
  source: NormalizedSource
  sessionId: string
  initialTokens: string[]
  initialRecoveredCount: number
  initialSkippedCount: number
  initialSkippedEntirely: boolean
  initialCompleted: boolean
  onBack: () => void
  onContinue: (result: {
    stagedTokens: string[]
    recoveredCount: number
    skippedCount: number
    skippedEntirely: boolean
  }) => void
}

export function DocumentsStep({
  source,
  sessionId,
  initialTokens,
  initialRecoveredCount,
  initialSkippedCount,
  initialSkippedEntirely,
  initialCompleted,
  onBack,
  onContinue,
}: Props) {
  const { t } = useTranslation()
  const discover = trpc.groups.discoverImportDocuments.useMutation()
  const presign = trpc.uploads.importDocumentPresign.useMutation()
  const [includeDocuments, setIncludeDocuments] = useState(
    !initialSkippedEntirely,
  )
  const [stagedTokens, setStagedTokens] = useState(initialTokens)
  const [recoveredCount, setRecoveredCount] = useState(initialRecoveredCount)
  const [acceptedSkippedCount, setAcceptedSkippedCount] =
    useState(initialSkippedCount)
  const [completed, setCompleted] = useState(initialCompleted)
  const [successfulDocumentIds, setSuccessfulDocumentIds] = useState(
    () => new Set<string>(),
  )
  const [totalFailure, setTotalFailure] = useState<Failure[] | null>(null)
  const [partialFailure, setPartialFailure] = useState<RecoveryState | null>(
    null,
  )
  const [processedCount, setProcessedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [isRecovering, setIsRecovering] = useState(false)

  const failureCount = (failures: Failure[]) =>
    failures.reduce((count, failure) => count + failure.documentCount, 0)

  function finish(result: RecoveryState, skippedEntirely = false) {
    onContinue({
      stagedTokens: result.stagedTokens,
      recoveredCount: result.recoveredCount,
      skippedCount: failureCount(result.failures),
      skippedEntirely,
    })
  }

  async function recoverDocuments() {
    setTotalFailure(null)
    setPartialFailure(null)
    setProcessedCount(0)
    setIsRecovering(true)

    const nextTokens = [...stagedTokens]
    const nextSuccessfulIds = new Set(successfulDocumentIds)
    const nextFailures: Failure[] = []
    try {
      const result = await discover.mutateAsync({
        sessionId,
        sourceGroupId: source.sourceGroupId,
        expenses: source.expenses.map((expense) => ({
          sourceCreatedAt: expense.sourceCreatedAt,
          title: expense.title,
        })),
      })
      nextFailures.push(...result.failures)
      const pendingDocuments = result.documents.filter(
        (document) => !nextSuccessfulIds.has(document.sourceDocumentId),
      )
      setTotalCount(pendingDocuments.length)

      for (const document of pendingDocuments) {
        try {
          const response = await fetch(
            `${getApiBaseUrl()}/imports/documents/file`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'x-import-document-token': document.token },
            },
          )
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as {
              error?: string
            }
            throw new Error(
              body.error ?? t('Groups.Import.Documents.fetchFailed'),
            )
          }

          const blob = await response.blob()
          const file = new File([blob], `${document.sourceDocumentId}.image`, {
            type: blob.type,
          })
          const resized = await resizeImage(file)
          if (resized.file.size > MAX_FILE_SIZE) {
            throw new Error(t('Groups.Import.Documents.tooLarge'))
          }

          const staged = await presign.mutateAsync({
            sessionId,
            sourceToken: document.token,
            fileSize: resized.file.size,
            width: resized.width,
            height: resized.height,
          })
          const upload = await fetch(staged.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            body: resized.file,
          })
          if (!upload.ok) {
            throw new Error(t('Groups.Import.Documents.uploadFailed'))
          }

          nextTokens.push(staged.stagedToken)
          nextSuccessfulIds.add(document.sourceDocumentId)
        } catch (error) {
          nextFailures.push({
            expenseTitle: document.expenseTitle,
            documentCount: 1,
            message:
              error instanceof Error
                ? error.message
                : t('Groups.Import.Documents.unknownFailure'),
          })
        } finally {
          setProcessedCount((count) => count + 1)
        }
      }

      const nextState = {
        stagedTokens: nextTokens,
        recoveredCount: nextTokens.length,
        failures: nextFailures,
      }
      setStagedTokens(nextTokens)
      setRecoveredCount(nextTokens.length)
      setSuccessfulDocumentIds(nextSuccessfulIds)

      if (nextFailures.length === 0) {
        setAcceptedSkippedCount(0)
        setCompleted(true)
        finish(nextState)
      } else if (nextTokens.length > 0) {
        setPartialFailure(nextState)
      } else {
        setTotalFailure(nextFailures)
      }
    } catch (error) {
      const failure = {
        expenseTitle: source.name,
        documentCount: 1,
        message:
          error instanceof Error
            ? error.message
            : t('Groups.Import.Documents.discoveryFailed'),
      }
      if (stagedTokens.length > 0) {
        setPartialFailure({
          stagedTokens,
          recoveredCount,
          failures: [failure],
        })
      } else {
        setTotalFailure([failure])
      }
    } finally {
      setIsRecovering(false)
    }
  }

  function handleContinue() {
    if (!includeDocuments) {
      finish({ stagedTokens: [], recoveredCount: 0, failures: [] }, true)
      return
    }
    if (completed) {
      onContinue({
        stagedTokens,
        recoveredCount,
        skippedCount: acceptedSkippedCount,
        skippedEntirely: false,
      })
      return
    }
    void recoverDocuments()
  }

  const displayedFailures = totalFailure ?? partialFailure?.failures ?? []
  const displayedFailureCount = failureCount(displayedFailures)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="font-medium">
              {t('Groups.Import.Documents.title')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Groups.Import.Documents.description')}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
            <Checkbox
              checked={includeDocuments}
              disabled={isRecovering}
              onCheckedChange={(checked) => {
                const include = checked === true
                setIncludeDocuments(include)
                setTotalFailure(null)
                if (include && initialSkippedEntirely) setCompleted(false)
              }}
            />
            <span className="leading-5">
              {t('Groups.Import.Documents.start')}
            </span>
          </label>

          {isRecovering && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>
                {t('Groups.Import.Documents.progress', {
                  processed: processedCount,
                  total: totalCount || '…',
                })}
              </span>
            </div>
          )}

          {!isRecovering &&
            includeDocuments &&
            completed &&
            recoveredCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('Groups.Import.Documents.recovered', {
                  count: recoveredCount,
                })}
              </p>
            )}

          {totalFailure && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {t('Groups.Import.Documents.failedTitle', {
                  count: displayedFailureCount,
                })}
              </AlertTitle>
              <AlertDescription className="space-y-3">
                <ul className="list-disc space-y-1 ps-4">
                  {totalFailure.map((failure, index) => (
                    <li key={`${failure.expenseTitle}:${index}`}>
                      <strong>{failure.expenseTitle}</strong>: {failure.message}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void recoverDocuments()}
                  >
                    {t('Groups.Import.Documents.retry')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      finish(
                        { stagedTokens: [], recoveredCount: 0, failures: [] },
                        true,
                      )
                    }
                  >
                    {t('Groups.Import.Documents.skip')}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <WizardNav
        step="documents"
        onBack={onBack}
        onContinue={handleContinue}
        continueDisabled={
          isRecovering || totalFailure !== null || partialFailure !== null
        }
      />

      <ResponsiveDialog
        open={partialFailure !== null}
        onOpenChange={(open) => {
          if (!open) setPartialFailure(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('Groups.Import.Documents.failedTitle', {
                count: displayedFailureCount,
              })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('Groups.Import.Documents.acceptMissing')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <ul className="list-disc space-y-1 ps-4 text-sm text-muted-foreground">
              {partialFailure?.failures.map((failure, index) => (
                <li key={`${failure.expenseTitle}:${index}`}>
                  <strong className="text-foreground">
                    {failure.expenseTitle}
                  </strong>
                  : {failure.message}
                </li>
              ))}
            </ul>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void recoverDocuments()}
            >
              {t('Groups.Import.Documents.retry')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!partialFailure) return
                const skippedCount = failureCount(partialFailure.failures)
                setAcceptedSkippedCount(skippedCount)
                setCompleted(true)
                finish(partialFailure)
              }}
            >
              {t('Groups.Import.Documents.continueWithMissing')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
