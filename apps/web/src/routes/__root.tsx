import { AppShell } from '@/AppShell'
import { QueryErrorState } from '@/components/query-error-state'
import { createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: AppShell,
  errorComponent: RootErrorComponent,
})

function RootErrorComponent({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <QueryErrorState onRetry={reset} onBack={() => window.history.back()} />
    </main>
  )
}
