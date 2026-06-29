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
import type { ExpenseFormValues } from '@spliit/domain'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>

export function DocumentsCard(props: {
  form: UseFormReturn<ExpenseFormValues, any, ExpenseFormValues>
  group: Group
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
}) {
  const { form, group, readOnly, sExpense } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>{t('attachDocuments')}</span>
        </CardTitle>
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
            />
          )}
        />
      </CardContent>
    </Card>
  )
}
