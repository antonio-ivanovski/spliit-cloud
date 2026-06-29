import { cn } from '@/lib/utils'

export function ParticipantPendingLabel({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <span className={cn('text-muted-foreground text-xs ml-1', className)}>
      {text}
    </span>
  )
}
