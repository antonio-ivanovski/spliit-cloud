import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'

import { getWebBaseUrl } from '../../auth/urls'
import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

const CREDENTIAL_LABEL = 'email and password'

function authBaseUrl(): string {
  return getWebBaseUrl()
}

// ---------------------------------------------------------------------------
// React Email components (used by both the renderer and `email dev` preview)
// ---------------------------------------------------------------------------

export function PasswordRecoveryEmail(props: {
  brandBaseUrl: string
  resetUrl: string
  otherMethods: string[]
}): ReactElement {
  return (
    <EmailLayout
      preview="Reset your Spliit Cloud password"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Reset your Spliit Cloud password
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        We received a request to reset the password for your Spliit Cloud
        account. Click the button below to choose a new password.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.resetUrl} label="Reset password" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.resetUrl} className="text-[#64748b] underline">
          {props.resetUrl}
        </Link>
      </Text>
      {props.otherMethods.length > 0 ? (
        <Text className="m-0 mb-4 text-[14px] leading-[22px] text-[#0f172a]">
          This account can also sign in with: {props.otherMethods.join(', ')}.
        </Text>
      ) : null}
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request a password reset, you can safely ignore this
        email.
      </Text>
    </EmailLayout>
  )
}

export function SignInGuidanceEmail(props: {
  brandBaseUrl: string
  methods: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Sign in to Spliit Cloud"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Sign in to Spliit Cloud
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        We received a password reset request for this Spliit Cloud account, but
        it does not have a password sign-in method. Please use one of the other
        sign-in methods instead.
      </Text>
      <Section className="my-4 rounded-md border border-solid border-[#e5e7eb] bg-[#f8fafc] px-5 py-4">
        <Text className="m-0 text-[14px] leading-[20px] text-[#0f172a]">
          <strong>Available methods:</strong> {props.methods}.
        </Text>
      </Section>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request this email, you can safely ignore it.
      </Text>
    </EmailLayout>
  )
}

export function VerificationEmail(props: {
  brandBaseUrl: string
  verificationUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Verify your Spliit Cloud account"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Verify your Spliit Cloud account
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Tap the button below to confirm your email and finish creating your
        Spliit Cloud account.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.verificationUrl} label="Verify my email" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.verificationUrl} className="text-[#64748b] underline">
          {props.verificationUrl}
        </Link>
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not create a Spliit Cloud account, you can safely ignore this
        email.
      </Text>
    </EmailLayout>
  )
}

export function EmailChangeOtpEmail(props: {
  brandBaseUrl: string
  otp: string
  expiresInMinutes: number
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud email confirmation code"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Confirm your email
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Use this code in Spliit Cloud to confirm your email address. It expires
        in {props.expiresInMinutes} minutes.
      </Text>
      <Section className="my-6 rounded-md border border-solid border-[#e5e7eb] bg-[#f8fafc] px-5 py-5 text-center">
        <Text className="m-0 font-mono text-[32px] leading-[40px] font-semibold tracking-[0.35em] text-[#0f172a]">
          {props.otp}
        </Text>
      </Section>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request this change, you can safely ignore this email.
      </Text>
    </EmailLayout>
  )
}

export function EmailChangedNoticeEmail(props: {
  brandBaseUrl: string
  newEmail: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud email address was changed"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your email address was changed
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        The email on your Spliit Cloud account is now {props.newEmail}.
      </Text>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        If you made this change, you can ignore this message. If you did not,
        sign in to Spliit Cloud and change the email back from account settings.
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        This notice was sent to the previous address on the account.
      </Text>
    </EmailLayout>
  )
}

export function PasswordSetNoticeEmail(props: {
  brandBaseUrl: string
  resetUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="A password was added to your Spliit Cloud account"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        A password was added to your account
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        A password was added to your Spliit Cloud account. You can now sign in
        with your email and password.
      </Text>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        If you made this change, you can ignore this message. If you did not,
        reset the password immediately.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.resetUrl} label="Reset password" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.resetUrl} className="text-[#64748b] underline">
          {props.resetUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function PasswordRemovedNoticeEmail(props: {
  brandBaseUrl: string
  resetUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="A password was removed from your Spliit Cloud account"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        A password was removed from your account
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        The password on your Spliit Cloud account was removed. You can still
        sign in with a magic link or a linked provider using your verified
        email.
      </Text>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        If you did not make this change, set a new password from account
        settings or reset it immediately.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.resetUrl} label="Reset password" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.resetUrl} className="text-[#64748b] underline">
          {props.resetUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function PasswordChangedNoticeEmail(props: {
  brandBaseUrl: string
  resetUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud password was changed"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your password was changed
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        The password on your Spliit Cloud account was changed. Other sessions
        have been signed out.
      </Text>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        If you did not make this change, reset the password immediately.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.resetUrl} label="Reset password" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.resetUrl} className="text-[#64748b] underline">
          {props.resetUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function MagicLinkEmail(props: {
  brandBaseUrl: string
  signInUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud sign-in link"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your Spliit Cloud sign-in link
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Click the button below to sign in to your Spliit Cloud account. The link
        will expire once used.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.signInUrl} label="Sign in to Spliit Cloud" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.signInUrl} className="text-[#64748b] underline">
          {props.signInUrl}
        </Link>
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request this email, you can safely ignore it.
      </Text>
    </EmailLayout>
  )
}

// ---------------------------------------------------------------------------
// Production renderers return the complete multipart email sent by SMTP.
// ---------------------------------------------------------------------------

/**
 * Render the password-recovery email.
 *
 * The credential-account variant carries a reset CTA plus a note listing the
 * other sign-in methods on this account. The magic-link-only variant explains
 * that there is no password to reset and instructs the user to use one of the
 * other methods.
 *
 * The text and HTML bodies share the same action and security guidance.
 */
export async function renderPasswordRecoveryEmail(input: {
  resetUrl: string
  methodLabels: string[]
}): Promise<RenderedEmail> {
  const hasPassword = input.methodLabels.includes(CREDENTIAL_LABEL)
  const otherMethods = input.methodLabels.filter(
    (method) => method !== CREDENTIAL_LABEL,
  )
  const baseUrl = authBaseUrl()

  if (hasPassword) {
    const extra =
      otherMethods.length > 0
        ? `\n\nThis account can also sign in with: ${otherMethods.join(', ')}.`
        : ''
    const text =
      `Click the link below to reset your Spliit Cloud password.\n\n${input.resetUrl}` +
      extra +
      `\n\nIf you did not request a password reset, you can safely ignore this email.`

    return renderTemplate(
      <PasswordRecoveryEmail
        brandBaseUrl={baseUrl}
        resetUrl={input.resetUrl}
        otherMethods={otherMethods}
      />,
      { subject: 'Reset your Spliit Cloud password', text },
    )
  }

  const methods =
    otherMethods.length > 0 ? otherMethods.join(', ') : 'an email sign-in link'
  const text =
    `We received a password reset request for this Spliit Cloud account, but it does not have a password sign-in method.\n\n` +
    `Use one of these sign-in methods instead: ${methods}.\n\n` +
    `If you did not request this email, you can safely ignore it.`

  return renderTemplate(
    <SignInGuidanceEmail brandBaseUrl={baseUrl} methods={methods} />,
    { subject: 'Sign in to Spliit Cloud', text },
  )
}

export async function renderVerificationEmail(input: {
  verificationUrl: string
}): Promise<RenderedEmail> {
  const text =
    `Click the link below to verify your email address and sign in to Spliit Cloud.\n\n${input.verificationUrl}\n\n` +
    `If you did not create a Spliit Cloud account, you can safely ignore this email.`

  return renderTemplate(
    <VerificationEmail
      brandBaseUrl={authBaseUrl()}
      verificationUrl={input.verificationUrl}
    />,
    { subject: 'Verify your Spliit Cloud account', text },
  )
}

export async function renderEmailChangeOtpEmail(input: {
  otp: string
  expiresInMinutes: number
}): Promise<RenderedEmail> {
  const text =
    `Use this code in Spliit Cloud to confirm your email address. It expires in ${input.expiresInMinutes} minutes.\n\n${input.otp}\n\n` +
    `If you did not request this change, you can safely ignore this email.`

  return renderTemplate(
    <EmailChangeOtpEmail
      brandBaseUrl={authBaseUrl()}
      otp={input.otp}
      expiresInMinutes={input.expiresInMinutes}
    />,
    { subject: 'Your Spliit Cloud email confirmation code', text },
  )
}

export async function renderEmailChangedNoticeEmail(input: {
  newEmail: string
}): Promise<RenderedEmail> {
  const text =
    `The email on your Spliit Cloud account is now ${input.newEmail}.\n\n` +
    `If you made this change, you can ignore this message. If you did not, sign in to Spliit Cloud and change the email back from account settings.`

  return renderTemplate(
    <EmailChangedNoticeEmail
      brandBaseUrl={authBaseUrl()}
      newEmail={input.newEmail}
    />,
    { subject: 'Your Spliit Cloud email address was changed', text },
  )
}

export async function renderPasswordSetNoticeEmail(): Promise<RenderedEmail> {
  const resetUrl = `${authBaseUrl()}/auth/forgot-password`
  const text =
    `A password was added to your Spliit Cloud account. You can now sign in with your email and password.\n\n` +
    `If you made this change, you can ignore this message. If you did not, reset the password immediately:\n\n${resetUrl}`

  return renderTemplate(
    <PasswordSetNoticeEmail brandBaseUrl={authBaseUrl()} resetUrl={resetUrl} />,
    { subject: 'A password was added to your Spliit Cloud account', text },
  )
}

export async function renderPasswordRemovedNoticeEmail(): Promise<RenderedEmail> {
  const resetUrl = `${authBaseUrl()}/auth/forgot-password`
  const text =
    `The password on your Spliit Cloud account was removed. You can still sign in with a magic link or a linked provider using your verified email.\n\n` +
    `If you did not make this change, set a new password from account settings or reset it immediately:\n\n${resetUrl}`

  return renderTemplate(
    <PasswordRemovedNoticeEmail
      brandBaseUrl={authBaseUrl()}
      resetUrl={resetUrl}
    />,
    { subject: 'A password was removed from your Spliit Cloud account', text },
  )
}

export async function renderPasswordChangedNoticeEmail(): Promise<RenderedEmail> {
  const resetUrl = `${authBaseUrl()}/auth/forgot-password`
  const text =
    `The password on your Spliit Cloud account was changed. Other sessions have been signed out.\n\n` +
    `If you did not make this change, reset the password immediately:\n\n${resetUrl}`

  return renderTemplate(
    <PasswordChangedNoticeEmail
      brandBaseUrl={authBaseUrl()}
      resetUrl={resetUrl}
    />,
    { subject: 'Your Spliit Cloud password was changed', text },
  )
}

export async function renderMagicLinkEmail(input: {
  signInUrl: string
}): Promise<RenderedEmail> {
  const text =
    `Click the link below to sign in to Spliit Cloud.\n\n${input.signInUrl}\n\n` +
    `If you did not request this email, you can safely ignore it.`

  return renderTemplate(
    <MagicLinkEmail brandBaseUrl={authBaseUrl()} signInUrl={input.signInUrl} />,
    { subject: 'Your Spliit Cloud sign-in link', text },
  )
}
