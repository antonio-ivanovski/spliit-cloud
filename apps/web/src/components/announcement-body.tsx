export function AnnouncementBody({ html }: { html: string }) {
  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert prose-h2:mt-0 prose-h2:mb-2 prose-h2:scroll-mt-4 prose-h2:text-lg prose-h2:font-semibold prose-h2:tracking-tight prose-h3:mt-5 prose-h3:mb-1.5 prose-h3:scroll-mt-4 prose-h3:text-base prose-h3:font-semibold prose-p:text-[15px] prose-p:leading-7 prose-p:text-foreground/90 prose-p:first-of-type:text-base prose-p:first-of-type:leading-7 prose-p:first-of-type:text-muted-foreground prose-a:font-medium prose-a:text-primary prose-ul:my-3 prose-li:my-1 [&_.announcement-heading:focus-within_a.announcement-anchor]:opacity-100 [&_.announcement-heading:hover_a.announcement-anchor]:opacity-100 [&_a.announcement-anchor]:mr-1.5 [&_a.announcement-anchor]:inline-flex [&_a.announcement-anchor]:align-middle [&_a.announcement-anchor]:font-normal [&_a.announcement-anchor]:text-muted-foreground [&_a.announcement-anchor]:no-underline [&_a.announcement-anchor]:opacity-0 [&_a.announcement-anchor]:transition-opacity [&_a.announcement-anchor]:hover:text-foreground [&_a.announcement-anchor]:pointer-coarse:opacity-100 [&_a.announcement-anchor_svg]:size-3.5 [&_section.announcement-section]:mt-8 [&_section.announcement-section]:border-t [&_section.announcement-section]:border-border [&_section.announcement-section]:pt-6"
      // HTML is produced by the constrained domain renderer (headings,
      // paragraphs, lists, links); no raw author HTML passes through.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function formatAnnouncementDate(
  dateIso: string,
  locale: string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(`${dateIso}T00:00:00Z`),
    )
  } catch {
    return dateIso
  }
}
