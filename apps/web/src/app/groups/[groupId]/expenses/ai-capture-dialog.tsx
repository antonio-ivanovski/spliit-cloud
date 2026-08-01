import type { LucideIcon } from 'lucide-react'
import { Sparkles } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  trigger?: ReactElement
}

export function AiCaptureDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  children,
  footer,
  trigger,
}: Props) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <ResponsiveDialogTrigger render={trigger} />}
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <span>{title}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Sparkles className="size-3" aria-hidden />
              AI
            </span>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          {children}
        </ResponsiveDialogBody>
        {footer && <ResponsiveDialogFooter>{footer}</ResponsiveDialogFooter>}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
