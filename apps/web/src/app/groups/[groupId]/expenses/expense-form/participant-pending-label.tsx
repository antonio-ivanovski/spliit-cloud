import { cn } from '@/lib/utils'

export function ParticipantPendingLabel({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <span className={cn('ml-1 text-xs text-muted-foreground', className)}>
      {text}
    </span>
  )
}
