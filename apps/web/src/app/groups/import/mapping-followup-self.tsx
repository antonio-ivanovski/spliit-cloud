import { useTranslation } from 'react-i18next'

export function SelfFollowUp({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('Groups.Import.Mapping.Row.linkToMeFollowUp', { name })}
    </p>
  )
}
