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
import { Paperclip } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Attachment = {
  id: string
  url: string
  width: number
  height: number
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
      <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" />
        {t('attachments', { count: documents.length })}
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {documents.slice(0, 4).map((document) => (
          <ResponsiveDialog key={document.id}>
            <ResponsiveDialogTrigger asChild>
              <Button
                variant="secondary"
                className="h-16 w-16 shrink-0 overflow-hidden rounded-md border p-0 shadow-inner"
                aria-label={t('attachments', { count: 1 })}
              >
                <Image
                  src={document.url}
                  width={document.width}
                  height={document.height}
                  className="h-full w-full object-cover"
                  alt=""
                />
              </Button>
            </ResponsiveDialogTrigger>
            <ResponsiveDialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl items-center justify-center p-4">
              <ResponsiveDialogTitle className="sr-only">
                {t('attachments', { count: 1 })}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                {t('attachments', { count: 1 })}
              </ResponsiveDialogDescription>
              <ResponsiveDialogBody className="flex h-full items-center justify-center p-0">
                <Image
                  src={document.url}
                  width={document.width}
                  height={document.height}
                  className="max-h-full max-w-full object-contain"
                  alt=""
                />
              </ResponsiveDialogBody>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        ))}
      </div>
    </section>
  )
}
