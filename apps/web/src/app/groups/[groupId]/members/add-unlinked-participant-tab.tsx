import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import {
  unlinkedParticipantFormSchema,
  type UnlinkedParticipantFormValues,
} from './members-hooks'

export function AddUnlinkedParticipantTab({
  isPending,
  onSubmit,
}: {
  isPending: boolean
  onSubmit: (values: UnlinkedParticipantFormValues) => Promise<boolean>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const form = useForm<UnlinkedParticipantFormValues>({
    resolver: zodResolver(unlinkedParticipantFormSchema),
    defaultValues: { displayName: '' },
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      if (await onSubmit(values)) form.reset({ displayName: '' })
    } catch {
      // Mutation callbacks already surface the failure; keep the form draft.
    }
  })

  return (
    <>
      <p className="border-s-2 border-primary/40 ps-3 text-sm text-muted-foreground">
        {t('invite.noAccountDescription')}
      </p>
      <Form {...form}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('invite.temporaryNameRequired')}</FormLabel>
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
                <FormDescription>
                  {t('invite.noAccountNameDescription')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              <UserPlus className="me-2 h-4 w-4" />
              {t('invite.addParticipant')}
            </Button>
          </div>
        </form>
      </Form>
    </>
  )
}
