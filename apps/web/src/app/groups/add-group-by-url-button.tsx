import { saveRecentGroup } from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTranslations } from '@/i18n/react'
import { useMediaQuery } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import { Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

type Props = {
  reload: () => void
}

export function AddGroupByUrlButton({ reload }: Props) {
  const t = useTranslations('Groups.AddByURL')
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [groupIdToAdd, setGroupIdToAdd] = useState<string | null>(null)
  const groupQuery = trpc.groups.get.useQuery(
    { groupId: groupIdToAdd ?? '' },
    { enabled: groupIdToAdd !== null, retry: false },
  )
  const pending = groupQuery.isFetching

  useEffect(() => {
    if (!groupIdToAdd || !groupQuery.isSuccess) return

    if (groupQuery.data.group) {
      saveRecentGroup({
        id: groupQuery.data.group.id,
        name: groupQuery.data.group.name,
      })
      reload()
      setUrl('')
      setOpen(false)
    } else {
      setError(true)
    }
    setGroupIdToAdd(null)
  }, [groupIdToAdd, groupQuery.data, groupQuery.isSuccess, reload])

  useEffect(() => {
    if (!groupIdToAdd || !groupQuery.isError) return

    setError(true)
    setGroupIdToAdd(null)
  }, [groupIdToAdd, groupQuery.isError])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary">{t('button')}</Button>
      </PopoverTrigger>
      <PopoverContent
        align={isDesktop ? 'end' : 'start'}
        className="[&_p]:text-sm flex flex-col gap-3"
      >
        <h3 className="font-bold">{t('title')}</h3>
        <p>{t('description')}</p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()

            let parsedUrl: URL
            try {
              parsedUrl = new URL(url)
            } catch {
              setError(true)
              return
            }

            if (parsedUrl.origin !== window.location.origin) {
              setError(true)
              return
            }

            const [, groupPath, groupId] = parsedUrl.pathname.split('/')
            if (groupPath !== 'groups' || !groupId) {
              setError(true)
              return
            }

            setError(false)
            setGroupIdToAdd(groupId)
          }}
        >
          <Input
            type="url"
            required
            placeholder="https://your-instance.com/..."
            className="flex-1 text-base"
            value={url}
            disabled={pending}
            onChange={(event) => {
              setUrl(event.target.value)
              setError(false)
            }}
          />
          <Button size="icon" type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </Button>
        </form>
        {error && <p className="text-destructive">{t('error')}</p>}
      </PopoverContent>
    </Popover>
  )
}
