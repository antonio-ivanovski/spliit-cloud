/**
 * Public result type for every email template in this package. Templates
 * produce both a styled HTML body and a plain-text body so any email
 * client (including Apple Mail, Outlook, and Gmail) renders something
 * sensible regardless of which version wins.
 */
export type RenderedEmail = {
  subject: string
  text: string
  html: string
}
