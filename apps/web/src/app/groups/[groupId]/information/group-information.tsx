import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'

export default function GroupInformation({ groupId }: { groupId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Information' })
  const { isLoading, group } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex justify-between">
            <span>{t('title')}</span>
            {/* PENDING invitees cannot edit group settings; the /edit route
                renders a read-only explanation for them. */}
            {!isPendingInvitee && (
              <Button size="icon" asChild className="-mb-12">
                <Link href={`/groups/${groupId}/edit`}>
                  <Pencil className="w-4 h-4" />
                </Link>
              </Button>
            )}
          </CardTitle>
          <CardDescription className="mr-12">
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm sm:prose-base max-w-full whitespace-break-spaces">
          {isLoading ? (
            <div className="py-1 flex flex-col gap-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : group.information ? (
            <p className="text-foreground">{group.information}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          )}
        </CardContent>
      </Card>
    </>
  )
}
