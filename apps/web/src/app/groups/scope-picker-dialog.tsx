import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'

export type ScopePickerItem = {
  id: string
  displayName: string
  meta?: string
  badge?: string
  onClick: () => void
}

export function ScopePickerDialog({
  open,
  onOpenChange,
  items,
  title,
  description,
  emptyLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ScopePickerItem[]
  title: string
  description?: string
  emptyLabel: string
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          {description && (
            <ResponsiveDialogDescription>
              {description}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      item.onClick()
                      onOpenChange(false)
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="font-medium">{item.displayName}</span>
                    {(item.meta || item.badge) && (
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {item.meta && <span>{item.meta}</span>}
                        {item.badge && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">
                            {item.badge}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
