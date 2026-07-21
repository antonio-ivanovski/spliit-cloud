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
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        Reset your Spliit Cloud password
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        We received a request to reset the password for your Spliit Cloud
        account. Click the button below to choose a new password.
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.resetUrl} label="Reset password" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
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
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        Sign in to Spliit Cloud
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        We received a password reset request for this Spliit Cloud account, but
        it does not have a password sign-in method. Please use one of the other
        sign-in methods instead.
      </Text>
      <Section className="bg-[#f8fafc] border border-solid border-[#e5e7eb] rounded-md px-5 py-4 my-4">
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
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        Verify your Spliit Cloud account
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Tap the button below to confirm your email and finish creating your
        Spliit Cloud account.
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.verificationUrl} label="Verify my email" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
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
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        Your Spliit Cloud sign-in link
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Click the button below to sign in to your Spliit Cloud account. The link
        will expire once used.
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.signInUrl} label="Sign in to Spliit Cloud" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
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
 * The credential-account variant carries a reset CTA plus a note
 * listing the other sign-in methods on this account. The
 * magic-link-only variant explains that there is no password to reset
 * and instructs the user to use one of the other methods.
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
