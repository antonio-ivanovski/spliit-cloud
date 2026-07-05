import { useTranslation } from 'react-i18next'

export function LinkFollowUp({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('Groups.Import.Mapping.Row.inviteByLinkFollowUp', { name })}
    </p>
  )
}
