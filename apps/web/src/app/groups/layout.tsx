import type { PropsWithChildren } from 'react'
import { Suspense } from 'react'

export default function GroupsLayout({ children }: PropsWithChildren<object>) {
  return (
    <Suspense>
      <main className="flex-1 min-w-0 max-w-(--breakpoint-md) w-full mx-auto overflow-x-hidden px-4 py-6 flex flex-col gap-6">
        {children}
      </main>
    </Suspense>
  )
}
