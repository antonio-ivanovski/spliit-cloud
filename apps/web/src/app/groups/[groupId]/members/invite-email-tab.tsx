import { UserPlus } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { EmailFormValues, InvitableRole } from './members-hooks'

export function InviteEmailTab({
  form,
  onSubmit,
  roleValue,
  onRoleChange,
  isPending,
  email,
}: {
  form: UseFormReturn<EmailFormValues>
  onSubmit: () => void
  roleValue: InvitableRole
  onRoleChange: (value: InvitableRole) => void
  isPending: boolean
  email: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <>
      <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
        {t('invite.emailDescription')}
      </p>
      <Form {...form}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('invite.email')}</FormLabel>
                <FormControl>
                  <Input
                    className="text-base"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder={t('invite.emailPlaceholder')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
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
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <FormItem className="space-y-0 sm:w-40">
              <FormLabel className="sm:sr-only">{t('invite.role')}</FormLabel>
              <FormControl>
                <Select
                  value={roleValue}
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
            <Button type="submit" disabled={isPending || !email}>
              <UserPlus className="mr-2 h-4 w-4" />
              {t('invite.send')}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}
