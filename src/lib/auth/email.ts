import { env } from '@/lib/env'
import { resolveMailer } from '@/lib/mail/mailer'

export async function sendMagicLinkEmail(
  email: string,
  magicLinkUrl: string,
): Promise<void> {
  const mailer = await resolveMailer()
  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Your Spliit sync magic link',
    text: `Use this link to sign in: ${magicLinkUrl}`,
  })
}
