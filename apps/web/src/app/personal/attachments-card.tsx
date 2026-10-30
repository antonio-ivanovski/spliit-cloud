import { useCallback, useEffect, useRef, useState } from 'react'

import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useEffectiveRuntimeFeatureFlags } from '@/lib/effective-runtime-feature-flags'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { usePersonalDocumentUpload } from '@/lib/upload'
import {
  isExpenseDocumentImage,
  mimeTypeForExpenseDocumentFileName,
} from '@spliit/domain'

import { useAddPersonalAttachment, useRemovePersonalAttachment } from './api'
import { usePersonalTranslation } from './personal-i18n'
import type { PersonalAttachment, PersonalEntry } from './types'

/** Server-enforced cap, mirrored from `MAX_PERSONAL_ATTACHMENTS`. */
const MAX_PERSONAL_ATTACHMENT_DOCUMENTS = 10

type Document = ExpenseFormInputValues['documents'][number]

function toDocument(attachment: PersonalAttachment): Document {
  return {
    id: attachment.id,
    url: attachment.url,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    width: attachment.width,
    height: attachment.height,
  }
}

type Props = {
  entry: PersonalEntry
  canEdit: boolean
  onChanged?: () => void
}

/**
 * Receipt/image/PDF attachments for a native Personal entry. Controlled by
 * `entry.attachments` with local state synced from the entry; uploads persist
 * through `personal.transactions.attachments.add` (presign → PUT → add) and
 * return the server attachment, removals diff against local state and call
 * `attachments.remove`. Renders only for editable native entries while the
 * expense-documents deployment flag is on. No OCR extraction.
 */
export function PersonalAttachmentsCard({ entry, canEdit, onChanged }: Props) {
  const { t } = usePersonalTranslation()
  const { toast } = useToast()
  const { flags } = useEffectiveRuntimeFeatureFlags()
  const { uploadToS3 } = usePersonalDocumentUpload()
  const addMutation = useAddPersonalAttachment()
  const removeMutation = useRemovePersonalAttachment()

  const [documents, setDocuments] = useState<Document[]>(() =>
    entry.attachments.map(toDocument),
  )
  const versionRef = useRef(entry.version)
  const pendingRef = useRef(false)

  // Sync from the entry (parent refetch after mutations). In-flight local
  // operations own the state until they settle, so they are never clobbered.
  const attachmentsKey = entry.attachments.map((a) => a.id).join(',')
  useEffect(() => {
    if (pendingRef.current) return
    setDocuments(entry.attachments.map(toDocument))
    versionRef.current = entry.version
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, entry.version, attachmentsKey])

  // The shared input owns file validation (type/size) and its toasts: this
  // transport only persists the validated file, so a failed file toasts
  // exactly once. Thrown errors surface through the shared generic toast.
  const uploadFile = useCallback(
    async ({
      file,
      width,
      height,
    }: {
      file: File
      width: number | null
      height: number | null
    }): Promise<Document> => {
      pendingRef.current = true
      try {
        const { url } = await uploadToS3(file)
        const image =
          isExpenseDocumentImage(file.type) ||
          mimeTypeForExpenseDocumentFileName(file.name)?.startsWith('image/')
        const attachment = await addMutation.mutateAsync({
          transactionId: entry.id,
          expectedVersion: versionRef.current,
          attachment: {
            url,
            fileName: file.name,
            contentType: image
              ? file.type || 'image/jpeg'
              : (mimeTypeForExpenseDocumentFileName(file.name) ?? file.type),
            ...(width != null ? { width } : {}),
            ...(height != null ? { height } : {}),
          },
        })
        versionRef.current += 1
        const document = toDocument(attachment)
        setDocuments((current) => [...current, document])
        onChanged?.()
        return document
      } finally {
        pendingRef.current = false
      }
    },
    [addMutation, entry.id, onChanged, uploadToS3],
  )

  const updateDocuments = useCallback(
    (next: Document[]) => {
      const removed = documents.filter(
        (document) => !next.some((item) => item.id === document.id),
      )
      if (removed.length === 0) {
        // Additions are already persisted by `uploadFile`; only sync state.
        setDocuments(next)
        return
      }
      const previous = documents
      setDocuments(next)
      pendingRef.current = true
      void (async () => {
        try {
          for (const document of removed) {
            await removeMutation.mutateAsync({
              transactionId: entry.id,
              attachmentId: document.id,
              expectedVersion: versionRef.current,
            })
            versionRef.current += 1
          }
          onChanged?.()
        } catch {
          // Revert to the pre-removal list so the UI matches the server.
          setDocuments(previous)
          toast({
            title: t('attachments.removeFailed'),
            variant: 'destructive',
          })
        } finally {
          pendingRef.current = false
        }
      })()
    },
    [documents, entry.id, onChanged, removeMutation, t, toast],
  )

  if (!canEdit || !entry.canEdit || entry.source !== 'PERSONAL') return null
  if (!flags.enableExpenseDocuments) return null

  return (
    <div className="space-y-2">
      <Label>{t('attachments.title')}</Label>
      <ExpenseDocumentsInput
        documents={documents}
        updateDocuments={updateDocuments}
        uploadFile={uploadFile}
        enableReceiptExtract={false}
        maxDocuments={MAX_PERSONAL_ATTACHMENT_DOCUMENTS}
        maxDocumentsReachedLabel={t('attachments.limitReached', {
          max: MAX_PERSONAL_ATTACHMENT_DOCUMENTS,
        })}
      />
    </div>
  )
}
