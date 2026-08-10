import type { ReactNode } from 'react'

type LegalPageProps = {
  title: string
  children: ReactNode
}

export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border bg-card px-5 py-8 shadow-sm sm:px-10 sm:py-12">
        <header className="mb-10 border-b pb-7">
          <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Spliit Cloud
          </p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: July 10, 2026
          </p>
        </header>
        <div className="space-y-8 text-sm leading-6 text-foreground sm:text-base sm:leading-7 [&_a]:underline [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:ps-5">
          {children}
        </div>
      </article>
    </main>
  )
}
