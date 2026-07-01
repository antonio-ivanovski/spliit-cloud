import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import Image from '@/components/app-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { useRouter } from '@/lib/navigation'
import { getImageData, maybeDecodeHeic, usePresignedUpload } from '@/lib/upload'
import {
  formatCurrency,
  formatDate,
  formatFileSize,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import {
  type CategoryId,
  categoryIdSchema,
  getCategoryById,
} from '@spliit/domain'
import { ChevronRight, FileQuestion, Loader2, Receipt } from 'lucide-react'
import type { PropsWithChildren, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from '../current-group-context'

const MAX_FILE_SIZE = 5 * 1024 ** 2

type ReceiptExtractedInfo = {
  amount: number
  categoryId: string | null
  currencyCode: string | null
  date: string | null
  title: string | null
}

export function CreateFromReceiptButton() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  const isDesktop = useMediaQuery('(min-width: 640px)')

  const DialogOrDrawer = isDesktop
    ? CreateFromReceiptDialog
    : CreateFromReceiptDrawer

  return (
    <DialogOrDrawer
      trigger={
        <Button
          size="icon"
          variant="secondary"
          title={t('Dialog.triggerTitle')}
        >
          <Receipt className="w-4 h-4" />
        </Button>
      }
      title={
        <>
          <span>{t('Dialog.title')}</span>
          <Badge className="bg-pink-700 hover:bg-pink-600 dark:bg-pink-500 dark:hover:bg-pink-600">
            Beta
          </Badge>
        </>
      }
      description={<>{t('Dialog.description')}</>}
    >
      <ReceiptDialogContent />
    </DialogOrDrawer>
  )
}

function ReceiptDialogContent() {
  const { group } = useCurrentGroup()

  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  const [pending, setPending] = useState(false)
  const { uploadToS3, FileInput, openFileDialog } = usePresignedUpload(
    group?.ledgerId,
  )
  const { toast } = useToast()
  const router = useRouter()
  const extractReceiptMutation =
    trpc.ai.extractExpenseInformationFromImage.useMutation()
  const [receiptInfo, setReceiptInfo] = useState<
    | null
    | (ReceiptExtractedInfo & { url: string; width?: number; height?: number })
  >(null)

  const handleFileChange = async (file: File) => {
    const decoded = await maybeDecodeHeic(file)
    if (decoded.size > MAX_FILE_SIZE) {
      toast({
        title: t('TooBigToast.title'),
        description: t('TooBigToast.description', {
          maxSize: formatFileSize(MAX_FILE_SIZE, locale),
          size: formatFileSize(decoded.size, locale),
        }),
        variant: 'destructive',
      })
      return
    }

    const upload = async () => {
      try {
        setPending(true)
        console.log('Uploading image…')
        const { url } = await uploadToS3(decoded)
        console.log('Extracting information from receipt…')
        const { amount, categoryId, currencyCode, date, title } =
          await extractReceiptMutation.mutateAsync({
            imageUrl: url,
            currency: group?.currency ?? '',
            currencyCode: group?.currencyCode,
          })
        const { width, height } = await getImageData(decoded)
        setReceiptInfo({
          amount,
          categoryId,
          currencyCode,
          date,
          title,
          url,
          width,
          height,
        })
      } catch (err) {
        console.error(err)
        toast({
          title: t('ErrorToast.title'),
          description: t('ErrorToast.description'),
          variant: 'destructive',
          action: (
            <ToastAction
              altText={t('ErrorToast.retry')}
              onClick={() => upload()}
            >
              {t('ErrorToast.retry')}
            </ToastAction>
          ),
        })
      } finally {
        setPending(false)
      }
    }
    upload()
  }

  const parsedReceiptCategoryId = receiptInfo?.categoryId
    ? categoryIdSchema.safeParse(receiptInfo.categoryId)
    : null
  const receiptInfoCategory =
    (parsedReceiptCategoryId?.success &&
      getCategoryById(parsedReceiptCategoryId.data)) ||
    null

  return (
    <div className="prose prose-sm dark:prose-invert">
      <p>{t('Dialog.body')}</p>
      <div>
        <FileInput
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        />
        <div className="grid gap-x-4 gap-y-2 grid-cols-3">
          <Button
            variant="secondary"
            className="row-span-3 w-full h-full relative"
            title="Create expense from receipt"
            onClick={openFileDialog}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : receiptInfo ? (
              <div className="absolute top-2 left-2 bottom-2 right-2">
                <Image
                  src={receiptInfo.url}
                  width={receiptInfo.width}
                  height={receiptInfo.height}
                  className="w-full h-full m-0 object-contain drop-shadow-lg"
                  alt="Scanned receipt"
                />
              </div>
            ) : (
              <span className="text-xs sm:text-sm text-muted-foreground">
                {t('Dialog.selectImage')}
              </span>
            )}
          </Button>
          <div className="col-span-2">
            <strong>{t('Dialog.titleLabel')}</strong>
            <div>{receiptInfo ? (receiptInfo.title ?? <Unknown />) : '…'}</div>
          </div>
          <div className="col-span-2">
            <strong>{t('Dialog.categoryLabel')}</strong>
            <div>
              {receiptInfo ? (
                receiptInfoCategory ? (
                  <div className="flex items-center">
                    <CategoryIcon
                      category={receiptInfoCategory}
                      className="inline w-4 h-4 mr-2"
                    />
                    <span className="mr-1">{receiptInfoCategory.grouping}</span>
                    <ChevronRight className="inline w-3 h-3 mr-1" />
                    <span>{receiptInfoCategory.name}</span>
                  </div>
                ) : (
                  <Unknown />
                )
              ) : (
                ''
              )}
            </div>
          </div>
          <div>
            <strong>{t('Dialog.amountLabel')}</strong>
            <div>
              {receiptInfo && group ? (
                receiptInfo.amount ? (
                  <>
                    {formatCurrency(
                      receiptInfo.currencyCode
                        ? (getCurrency(receiptInfo.currencyCode) ??
                            getCurrencyFromGroup(group))
                        : getCurrencyFromGroup(group),
                      receiptInfo.amount,
                      locale,
                    )}
                  </>
                ) : (
                  <Unknown />
                )
              ) : (
                '…'
              )}
            </div>
          </div>
          <div>
            <strong>{t('Dialog.dateLabel')}</strong>
            <div>
              {receiptInfo ? (
                receiptInfo.date ? (
                  formatDate(
                    new Date(`${receiptInfo?.date}T12:00:00.000Z`),
                    locale,
                    { dateStyle: 'medium' },
                  )
                ) : (
                  <Unknown />
                )
              ) : (
                '…'
              )}
            </div>
          </div>
        </div>
      </div>
      <p>{t('Dialog.editNext')}</p>
      <div className="text-center">
        <Button
          disabled={pending || !receiptInfo}
          onClick={() => {
            if (!receiptInfo || !group) return
            router.push({
              to: '/groups/$groupId/expenses/create',
              params: { groupId: group.id },
              search: {
                amount: receiptInfo.amount.toString(),
                categoryId:
                  (receiptInfo.categoryId as CategoryId | undefined) ??
                  undefined,
                originalCurrency: receiptInfo.currencyCode ?? undefined,
                date: receiptInfo.date ?? undefined,
                title: receiptInfo.title ?? undefined,
                imageUrl: receiptInfo.url,
                imageWidth:
                  receiptInfo.width !== undefined
                    ? receiptInfo.width.toString()
                    : undefined,
                imageHeight:
                  receiptInfo.height !== undefined
                    ? receiptInfo.height.toString()
                    : undefined,
              },
            })
          }}
        >
          {t('Dialog.continue')}
        </Button>
      </div>
    </div>
  )
}

function Unknown() {
  const { t } = useTranslation(undefined, { keyPrefix: 'CreateFromReceipt' })
  return (
    <div className="flex gap-1 items-center text-muted-foreground">
      <FileQuestion className="w-4 h-4" />
      <em>{t('unknown')}</em>
    </div>
  )
}

function CreateFromReceiptDialog({
  trigger,
  title,
  description,
  children,
}: PropsWithChildren<{
  trigger: ReactNode
  title: ReactNode
  description: ReactNode
}>) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
          <DialogDescription className="text-left">
            {description}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CreateFromReceiptDrawer({
  trigger,
  title,
  description,
  children,
}: PropsWithChildren<{
  trigger: ReactNode
  title: ReactNode
  description: ReactNode
}>) {
  return (
    <Drawer>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">{title}</DrawerTitle>
          <DrawerDescription className="text-left">
            {description}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-4">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
