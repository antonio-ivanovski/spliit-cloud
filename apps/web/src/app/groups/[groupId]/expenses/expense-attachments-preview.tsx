import { FileText, Paperclip } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import Image from '@/components/app-image'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import { isExpenseDocumentImage } from '@spliit/domain'

type Attachment = {
  id: string
  url: string
  fileName?: string | null
  contentType?: string | null
  width?: number | null
  height?: number | null
}

function isImageAttachment(document: Attachment): boolean {
  return (
    isExpenseDocumentImage(document.contentType) ||
    (!document.contentType && document.width != null && document.height != null)
  )
}

export function ExpenseAttachmentsPreview({
  documents,
}: {
  documents: Attachment[]
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpensePreview' })
  if (documents.length === 0) return null

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Paperclip className="h-3.5 w-3.5" />
        {t('attachments', { count: documents.length })}
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {documents.slice(0, 4).map((document) => (
          <ResponsiveDialog key={document.id}>
            <ResponsiveDialogTrigger
              render={
                <Button
                  variant="secondary"
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-md border p-0 shadow-inner"
                  aria-label={t('attachments', { count: 1 })}
                >
                  {isImageAttachment(document) ? (
                    <Image
                      src={document.url}
                      width={document.width ?? 300}
                      height={document.height ?? 300}
                      className="h-full w-full object-cover"
                      alt=""
                    />
                  ) : (
                    <FileText className="h-7 w-7 text-muted-foreground" />
                  )}
                </Button>
              }
            />
            <ResponsiveDialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl items-center justify-center p-4">
              <ResponsiveDialogTitle className="sr-only">
                {t('attachments', { count: 1 })}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                {t('attachments', { count: 1 })}
              </ResponsiveDialogDescription>
              <ResponsiveDialogBody className="flex h-full items-center justify-center p-0">
                {isImageAttachment(document) ? (
                  <Image
                    src={document.url}
                    width={document.width ?? 300}
                    height={document.height ?? 300}
                    className="max-h-full max-w-full object-contain"
                    alt=""
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 text-center">
                    <FileText className="h-20 w-20 text-muted-foreground" />
                    <p className="max-w-md font-medium break-words">
                      {document.fileName ?? t('attachments', { count: 1 })}
                    </p>
                    <Button
                      nativeButton={false}
                      render={
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t('openDocument')}
                        >
                          <span className="sr-only">{t('openDocument')}</span>
                        </a>
                      }
                    >
                      {t('openDocument')}
                    </Button>
                  </div>
                )}
              </ResponsiveDialogBody>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        ))}
      </div>
    </section>
  )
}
