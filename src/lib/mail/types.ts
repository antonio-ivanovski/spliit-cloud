export type MailMessage = {
  from?: string
  to: string
  subject: string
  text?: string
  html?: string
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>
}
