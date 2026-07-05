import { useTranslation } from 'react-i18next'

export function UnlinkedFollowUp({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('Groups.Import.Mapping.Row.leaveUnlinkedFollowUp', { name })}
    </p>
  )
}
