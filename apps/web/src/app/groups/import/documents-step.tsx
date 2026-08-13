import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

import type { CloudGroupBundleInspection } from './cloud-bundle'
import type { CloudStagedDocument } from './cloud-import-flow'
import { WizardNav } from './wizard-nav'

const MAX_FILE_SIZE = 2 * 1024 ** 2

type Failure = {
  expenseTitle: string
  documentCount: number
  message: string
  sourceId?: string
  path?: string | null
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
  cloud?: {
    inspection: CloudGroupBundleInspection
    initialDocuments: CloudStagedDocument[]
    initialIssues: Array<{
      sourceId: string
      path: string | null
      message: string
    }>
    initialSkippedDocumentIds: string[]
    onContinue: (result: {
      stagedDocuments: CloudStagedDocument[]
      skippedDocumentIds: string[]
      acknowledgedIssues: boolean
    }) => void
  }
  onBack: () => void
  onContinue: (result: {
    stagedTokens: string[]
    recoveredCount: number
    skippedCount: number
    skippedEntirely: boolean
    cloudDocuments?: CloudStagedDocument[]
    cloudSkippedDocumentIds?: string[]
    cloudIssuesAcknowledged?: boolean
  }) => void
}

const DOCUMENT_STAGING_TIMEOUT_MS = 60_000

function failureCount(failures: Failure[]) {
  return failures.reduce((count, failure) => count + failure.documentCount, 0)
}

function dedupeFailures(failures: Failure[]) {
  return failures.filter(
    (failure, index, all) =>
      all.findIndex((candidate) => candidate.sourceId === failure.sourceId) ===
      index,
  )
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted)
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    )
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onTimeout?: () => void,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.()
      reject(new Error('Document staging timed out.'))
    }, DOCUMENT_STAGING_TIMEOUT_MS)
  })
  try {
    return await Promise.race([promise, timeoutPromise, abortPromise(signal)])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function cloudIncludedDocuments(inspection: CloudGroupBundleInspection) {
  return inspection.manifest.expenses
    .flatMap((expense) => expense.documents)
    .concat(inspection.manifest.orphanDocuments)
    .filter((document) => document.status === 'INCLUDED')
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- one shared recovery UI coordinates legacy and exact-byte Cloud adapters
export function DocumentsStep({
  source,
  sessionId,
  initialTokens,
  initialRecoveredCount,
  initialSkippedCount,
  initialSkippedEntirely,
  initialCompleted,
  cloud,
  onBack,
  onContinue,
}: Props) {
  const { t } = useTranslation()
  const discover = trpc.groups.discoverImportDocuments.useMutation()
  const presign = trpc.uploads.importDocumentPresign.useMutation()
  const cloudPresign = trpc.uploads.cloudImportDocumentPresign.useMutation()
  const cloudAvailableDocumentCount = cloud?.inspection.documents.size ?? 0
  const cloudTotalDocumentCount = cloud
    ? cloud.inspection.manifest.expenses.reduce(
        (count, expense) => count + expense.documents.length,
        cloud.inspection.manifest.orphanDocuments.length,
      )
    : 0
  const cloudIssues = cloud
    ? (() => {
        const known = new Set(
          cloud.initialIssues.map((issue) => issue.sourceId),
        )
        const missingBytes = cloudIncludedDocuments(cloud.inspection)
          .filter(
            (document) =>
              !cloud.inspection.documents.has(document.sourceId) &&
              !known.has(document.sourceId),
          )
          .map((document) => ({
            sourceId: document.sourceId,
            path: document.path,
            message: 'The included document bytes are missing from the bundle.',
          }))
        return [...cloud.initialIssues, ...missingBytes]
      })()
    : []
  const [includeDocuments, setIncludeDocuments] = useState(
    cloud
      ? cloudAvailableDocumentCount > 0 && !initialSkippedEntirely
      : !initialSkippedEntirely,
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
  const [cloudStagedDocuments, setCloudStagedDocuments] = useState<
    CloudStagedDocument[]
  >(cloud?.initialDocuments ?? [])
  const [cloudIssuesAcknowledged, setCloudIssuesAcknowledged] = useState(
    () =>
      !cloud ||
      cloudIssues.length === 0 ||
      cloud.initialSkippedDocumentIds.length > 0,
  )
  const activeRunRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => activeRunRef.current?.abort()
  }, [])

  function finish(
    result: RecoveryState,
    skippedEntirely = false,
    cloudDocumentsOverride?: CloudStagedDocument[],
  ) {
    if (cloud) {
      const skippedDocumentIds = cloudIncludedDocuments(cloud.inspection)
        .map((document) => document.sourceId)
        .filter(
          (sourceId) =>
            skippedEntirely ||
            result.failures.some((failure) => failure.sourceId === sourceId),
        )
      cloud.onContinue({
        stagedDocuments: cloudDocumentsOverride ?? cloudStagedDocuments,
        skippedDocumentIds: [
          ...new Set([
            ...cloudIssues.map((issue) => issue.sourceId),
            ...cloud.initialSkippedDocumentIds,
            ...skippedDocumentIds,
          ]),
        ],
        acknowledgedIssues:
          skippedEntirely ||
          result.failures.length > 0 ||
          (cloudIssues.length > 0 && cloudIssuesAcknowledged),
      })
      return
    }
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
    const controller = new AbortController()
    activeRunRef.current?.abort()
    activeRunRef.current = controller

    const nextTokens = [...stagedTokens]
    const nextSuccessfulIds = new Set(successfulDocumentIds)
    const nextFailures: Failure[] = []
    try {
      if (cloud) {
        const includedDocuments = cloudIncludedDocuments(cloud.inspection)
        const alreadyStaged = new Set(
          cloudStagedDocuments.map((document) => document.sourceDocumentId),
        )
        const knownIssues = new Set(cloudIssues.map((issue) => issue.sourceId))
        const pendingDocuments = includedDocuments.filter(
          (document) =>
            !alreadyStaged.has(document.sourceId) &&
            !knownIssues.has(document.sourceId),
        )
        setTotalCount(pendingDocuments.length)
        const nextCloudDocuments = [...cloudStagedDocuments]
        for (const document of pendingDocuments) {
          if (controller.signal.aborted) break
          const bytes = cloud.inspection.documents.get(document.sourceId)
          const documentController = new AbortController()
          const abortDocument = () => documentController.abort()
          controller.signal.addEventListener('abort', abortDocument, {
            once: true,
          })
          try {
            if (!bytes) {
              throw new Error(
                'The included document bytes are missing from the bundle.',
              )
            }
            const staged = await withTimeout(
              cloudPresign.mutateAsync({
                sessionId,
                sourceDocumentId: document.sourceId,
                fileName: document.fileName,
                contentType: document.contentType,
                fileSize: bytes.byteLength,
                width: document.width,
                height: document.height,
                sha256: document.sha256!,
              }),
              documentController.signal,
              abortDocument,
            )
            const upload = await withTimeout(
              fetch(staged.uploadUrl, {
                method: 'PUT',
                headers: {
                  'Content-Type':
                    document.contentType ?? 'application/octet-stream',
                },
                body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
                signal: documentController.signal,
              }),
              documentController.signal,
              abortDocument,
            )
            if (!upload.ok) throw new Error(`Upload failed (${upload.status})`)
            nextCloudDocuments.push({
              sourceDocumentId: document.sourceId,
              stagedToken: staged.stagedToken,
            })
          } catch (error) {
            if (controller.signal.aborted) break
            nextFailures.push({
              expenseTitle: document.fileName ?? document.sourceId,
              documentCount: 1,
              sourceId: document.sourceId,
              path: document.path,
              message:
                error instanceof Error
                  ? error.message
                  : 'The document could not be staged.',
            })
          } finally {
            controller.signal.removeEventListener('abort', abortDocument)
            setProcessedCount((count) => count + 1)
          }
        }
        if (controller.signal.aborted) return
        setCloudStagedDocuments(nextCloudDocuments)
        const nextState = {
          stagedTokens: nextCloudDocuments.map(
            (document) => document.stagedToken,
          ),
          recoveredCount: nextCloudDocuments.length,
          failures: dedupeFailures(nextFailures),
        }
        setStagedTokens(nextState.stagedTokens)
        setRecoveredCount(nextState.recoveredCount)
        setAcceptedSkippedCount(nextState.failures.length)
        setCompleted(nextState.failures.length === 0)
        if (nextState.failures.length === 0)
          finish(nextState, false, nextCloudDocuments)
        else if (nextCloudDocuments.length > 0) setPartialFailure(nextState)
        else setTotalFailure(nextState.failures)
        return
      }
      const result = await discover.mutateAsync({
        sessionId,
        sourceGroupId: source.sourceGroupId,
        exportVersion: source.exportVersion,
        expenses: source.expenses.map((expense) => ({
          sourceCreatedAt: expense.sourceCreatedAt,
          title: expense.title,
          sourceDocuments: expense.sourceDocuments,
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
      if (activeRunRef.current === controller) activeRunRef.current = null
    }
  }

  function handleContinue() {
    if (!includeDocuments) {
      finish({ stagedTokens: [], recoveredCount: 0, failures: [] }, true)
      return
    }
    if (completed) {
      if (cloud) {
        cloud.onContinue({
          stagedDocuments: cloudStagedDocuments,
          skippedDocumentIds: [
            ...new Set([
              ...cloudIssues.map((issue) => issue.sourceId),
              ...cloud.initialSkippedDocumentIds,
            ]),
          ],
          acknowledgedIssues:
            acceptedSkippedCount > 0 ||
            cloud.initialSkippedDocumentIds.length > 0 ||
            (cloudIssues.length > 0 && cloudIssuesAcknowledged),
        })
        return
      }
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
  const cloudHasDocuments = cloudTotalDocumentCount > 0
  const cloudHasAvailableDocuments = cloudAvailableDocumentCount > 0
  const cloudNeedsIssueAcknowledgement =
    cloud !== undefined && cloudIssues.length > 0 && !cloudIssuesAcknowledged

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="font-medium">
              {t('Groups.Import.Documents.title')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                cloud
                  ? 'Groups.Import.Documents.cloudDescription'
                  : 'Groups.Import.Documents.description',
              )}
            </p>
          </div>

          {cloud && !cloudHasDocuments && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t('Groups.Import.Documents.cloudNoDocuments')}
            </p>
          )}

          {cloud && cloudHasDocuments && (
            <>
              <p className="text-sm text-muted-foreground">
                {cloudHasAvailableDocuments
                  ? t('Groups.Import.Cloud.documentsSummary', {
                      included: cloudAvailableDocumentCount,
                      total: cloudTotalDocumentCount,
                      maxSize: MAX_FILE_SIZE / 1024 / 1024,
                    })
                  : t('Groups.Import.Documents.cloudNoDocumentsAvailable')}
              </p>
              {cloudHasAvailableDocuments && (
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
                    {t('Groups.Import.Documents.cloudStart', {
                      count: cloudAvailableDocumentCount,
                    })}
                  </span>
                </label>
              )}
            </>
          )}

          {!cloud && (
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
          )}

          {cloud && cloudIssues.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {t('Groups.Import.Cloud.documentIssuesTitle')}
              </AlertTitle>
              <AlertDescription className="space-y-3">
                <ul className="list-disc space-y-1 ps-4">
                  {cloudIssues.map((issue) => (
                    <li key={issue.sourceId}>
                      <strong>{issue.path ?? issue.sourceId}</strong>:{' '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox
                    checked={cloudIssuesAcknowledged}
                    disabled={isRecovering}
                    onCheckedChange={(checked) =>
                      setCloudIssuesAcknowledged(checked === true)
                    }
                  />
                  <span className="leading-5">
                    {t('Groups.Import.Cloud.acknowledgeDocuments')}
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          )}

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
                  {totalFailure.map((failure) => (
                    <li
                      key={`${failure.sourceId ?? failure.expenseTitle}:${failure.message}`}
                    >
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
        onBack={() => {
          activeRunRef.current?.abort()
          onBack()
        }}
        onContinue={handleContinue}
        continueDisabled={
          isRecovering ||
          totalFailure !== null ||
          partialFailure !== null ||
          cloudNeedsIssueAcknowledgement
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
              {partialFailure?.failures.map((failure) => (
                <li
                  key={`${failure.sourceId ?? failure.expenseTitle}:${failure.message}`}
                >
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
