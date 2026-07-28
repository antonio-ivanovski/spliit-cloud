import { Link2, Share2 } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  formatDate,
  type GeneratedLink,
  type InvitableRole,
  type LinkFormValues,
} from './members-hooks'

export function InviteLinkTab({
  linkForm,
  onSubmit,
  linkRoleValue,
  onRoleChange,
  isPending,
  generatedLink,
  canShare,
  groupName,
  onShare,
}: {
  linkForm: UseFormReturn<LinkFormValues>
  onSubmit: () => void
  linkRoleValue: InvitableRole
  onRoleChange: (value: InvitableRole) => void
  isPending: boolean
  generatedLink: GeneratedLink | null
  canShare: boolean
  groupName: string
  onShare: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <>
      <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
        {t('invite.linkDescription')}
      </p>
      <Form {...linkForm}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <FormField
            control={linkForm.control}
            name="temporaryName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('invite.temporaryName')}</FormLabel>
                <FormControl>
                  <Input
                    className="text-base"
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('invite.temporaryNamePlaceholder')}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <FormItem className="space-y-0 sm:w-40">
              <FormLabel className="sm:sr-only">{t('invite.role')}</FormLabel>
              <FormControl>
                <Select
                  value={linkRoleValue}
                  onValueChange={(value) =>
                    onRoleChange(value as InvitableRole)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">{t('role.member')}</SelectItem>
                    <SelectItem value="ADMIN">{t('role.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
            </FormItem>
            <Button type="submit" disabled={isPending}>
              <Link2 className="mr-2 h-4 w-4" />
              {isPending
                ? t('invite.link.generating')
                : generatedLink
                  ? t('invite.link.generateNew')
                  : t('invite.link.generate')}
            </Button>
          </div>
        </form>
      </Form>

      {generatedLink && (
        <div
          className="mt-4 flex flex-col gap-3"
          data-testid="generated-invite-link"
        >
          <p className="text-sm text-muted-foreground">
            {t('invite.link.intro', { groupName })}
          </p>
          <p className="border-l-2 border-amber-500/50 pl-3 text-sm text-amber-900 dark:text-amber-200">
            {t('invite.link.singleUse')}
          </p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={generatedLink.inviteUrl}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton text={generatedLink.inviteUrl} />
            {canShare && (
              <Button
                size="icon"
                variant="secondary"
                type="button"
                onClick={onShare}
                aria-label={t('invite.link.share')}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('invite.link.expiresOn', {
              date: formatDate(generatedLink.expiresAt, 'en'),
            })}
          </p>
        </div>
      )}
    </>
  )
}
