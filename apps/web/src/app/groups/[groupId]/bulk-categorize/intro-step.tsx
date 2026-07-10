import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  BULK_CALIBRATION_CANDIDATE_POOL_SIZE,
  BULK_CALIBRATION_SAMPLE_SIZE,
} from '@spliit/domain'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function IntroStep(props: {
  totalEligible: number
  isLoading: boolean
  onStart: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'BulkCategorize' })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('introTitle')}</CardTitle>
        <CardDescription>
          {props.isLoading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />{' '}
              {t('loadingCandidates')}
            </span>
          ) : props.totalEligible > 0 ? (
            t('introDescription', { count: props.totalEligible })
          ) : (
            t('noCandidates')
          )}
        </CardDescription>
      </CardHeader>
      {props.totalEligible > 0 && !props.isLoading && (
        <>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                {t('introStepLook', {
                  count: BULK_CALIBRATION_CANDIDATE_POOL_SIZE,
                })}
              </li>
              <li>
                {t('introStepReview', { count: BULK_CALIBRATION_SAMPLE_SIZE })}
              </li>
              <li>{t('introStepPreview')}</li>
            </ol>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="button" onClick={props.onStart}>
              <Sparkles className="mr-2 h-4 w-4" />
              {t('startCalibration')}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  )
}
