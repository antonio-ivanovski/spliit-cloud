import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useTranslation } from 'react-i18next'

type Mode = 'sign-in' | 'sign-up'

export function AuthCard({
  mode,
  children,
}: {
  mode: Mode
  children: React.ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  return (
    <Card className="w-full border-border/80 shadow-sm">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">
          {mode === 'sign-in' ? t('title') : t('signUpTitle')}
        </CardTitle>
        <CardDescription>
          {mode === 'sign-in' ? t('subtitle') : t('signUpSubtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
