import { Card, CardContent } from '@/components/ui/card'
import { DomainSwapTyping } from './domain-swap-typing'

type DomainSwapCardProps = {
  disabled?: boolean
  title: string
  description: string
}

export function DomainSwapCard({ title, description }: DomainSwapCardProps) {
  return (
    <Card className="relative overflow-hidden border-primary/30 bg-linear-to-br from-primary/8 via-background to-background shadow-[0_1px_0_0_hsl(var(--primary)/0.1)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl"
      />
      <CardContent className="relative flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2.5">
          <DomainSwapTyping />
        </div>
      </CardContent>
    </Card>
  )
}
