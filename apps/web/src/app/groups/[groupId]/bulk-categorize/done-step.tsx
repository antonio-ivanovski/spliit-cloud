import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function DoneStep(props: { groupId: string; applied: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Check className="h-5 w-5 text-emerald-600" />
          {t('doneTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {t('saved', { count: props.applied })}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button asChild>
          <Link href={`/groups/${props.groupId}/edit`}>
            {t('backToSettings')}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
