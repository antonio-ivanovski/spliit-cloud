import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Globe } from 'lucide-react'

type PasteUrlCardProps = {
  disabled: boolean
  isPending: boolean
  url: string
  urlError: string | null
  onUrlChange: (value: string) => void
  onSubmit: () => void
  labels: {
    pasteUrl: string
    urlDescription: string
    urlPlaceholder: string
    fetchGroupButton: string
    fetchingButton: string
  }
}

export function PasteUrlCard({
  disabled,
  isPending,
  url,
  urlError,
  onUrlChange,
  onSubmit,
  labels,
}: PasteUrlCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <Label htmlFor="spliit-url" className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          {labels.pasteUrl}
        </Label>
        <p className="text-xs text-muted-foreground">{labels.urlDescription}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="spliit-url"
            placeholder={labels.urlPlaceholder}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            disabled={disabled}
          />
          <Button
            onClick={onSubmit}
            disabled={disabled || isPending || url.trim().length === 0}
            className="sm:w-auto"
          >
            {isPending ? labels.fetchingButton : labels.fetchGroupButton}
          </Button>
        </div>
        {urlError && <p className="text-sm text-destructive">{urlError}</p>}
      </CardContent>
    </Card>
  )
}
