import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ExpenseDocumentsInput } from '@/components/expense-documents-input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FormField } from '@/components/ui/form'
import type { AppRouterOutput } from '@spliit/api/router'
import type { ExpenseFormInputValues } from '@spliit/domain'

import type {
  ReceiptDocument,
  ReceiptExtractedInfo,
  ReceiptScanContext,
} from '../create-from-receipt-button'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function DocumentsCard(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  enableReceiptExtract: boolean
  receiptContext: ReceiptScanContext
  onReceiptAccepted: (result: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => void
}) {
  const {
    form,
    group,
    readOnly,
    sExpense,
    enableReceiptExtract,
    receiptContext,
    onReceiptAccepted,
  } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('attachDocuments')}</CardTitle>
        <CardDescription>{t(`${sExpense}.attachDescription`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="documents"
          render={({ field }) => (
            <ExpenseDocumentsInput
              documents={field.value}
              updateDocuments={field.onChange}
              ledgerId={group.ledgerId}
              readOnly={readOnly}
              enableReceiptExtract={enableReceiptExtract}
              receiptContext={receiptContext}
              onReceiptAccepted={onReceiptAccepted}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}
