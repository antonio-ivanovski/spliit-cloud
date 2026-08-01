import type { ReactNode } from 'react'

export function FixedActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.06)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-(--breakpoint-md) flex-row items-center justify-end gap-2 px-4">
        {children}
      </div>
    </div>
  )
}
