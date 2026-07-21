import { Heading, Link, Section, Text } from '@react-email/components'
import type { GroupRole } from '@spliit/db'
import type { ReactElement } from 'react'
import { getWebBaseUrl } from '../../auth/urls'
import { EmailButton } from './components/email-button'
import { EmailInfoBlock } from './components/email-info-block'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

const PROVIDER_LABELS: Record<string, string> = {
  SPLIIT: 'a Spliit export',
  SPLITWISE: 'a Splitwise export',
}

export type InvitationEmailInput = {
  invitationId: string
  groupId: string
  groupName: string
  inviterDisplayName: string
  inviterRole: GroupRole
  recipientEmail: string
  recipientIsExistingUser: boolean
  temporaryName?: string | null
  sourceProvider?: string
  sourceGroupName?: string
  expenseCount?: number
  totalAmount?: number
  currencyCode?: string | null
  unsubscribeUrl?: string
}

export function InvitationEmail(
  props: InvitationEmailInput & {
    acceptUrl: string
    signInUrl: string
    brandBaseUrl: string
  },
): ReactElement {
  const primaryHref = props.recipientIsExistingUser
    ? props.acceptUrl
    : props.signInUrl
  const primaryLabel = props.recipientIsExistingUser
    ? 'Open Spliit Cloud'
    : 'Create an account'
  const fallbackHref = primaryHref

  const preview = `${props.inviterDisplayName} invited you to ${props.groupName} on Spliit Cloud`

  const roleSentence = props.recipientIsExistingUser
    ? `${props.inviterDisplayName} (${props.inviterRole.toLowerCase()}) invited you to join "${props.groupName}".`
    : `${props.inviterDisplayName} invited you to join "${props.groupName}".`

  return (
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        You're invited to {props.groupName}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        {roleSentence}
      </Text>
      {props.temporaryName ? (
        <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
          You will appear as <strong>"{props.temporaryName}"</strong> in this
          group.
        </Text>
      ) : null}
      <Section className="text-center my-6">
        <EmailButton href={primaryHref} label={primaryLabel} />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={fallbackHref} className="text-[#64748b] underline">
          {fallbackHref}
        </Link>
      </Text>
      {props.sourceProvider ? (
        <EmailInfoBlock>
          <strong>Import context:</strong> This invitation is part of an import
          from{' '}
          {PROVIDER_LABELS[props.sourceProvider] ??
            `a ${props.sourceProvider.toLowerCase()} export`}
          .
          {props.sourceGroupName ? (
            <>
              {' '}
              Source group: <strong>{props.sourceGroupName}</strong>.
            </>
          ) : null}
          {props.expenseCount != null ? (
            <>
              {' '}
              The group contains {props.expenseCount} expense
              {props.expenseCount === 1 ? '' : 's'} from the import
              {props.totalAmount != null && props.currencyCode
                ? ` (total ${props.currencyCode} ${(props.totalAmount / 100).toFixed(2)})`
                : ''}
              .
            </>
          ) : null}
        </EmailInfoBlock>
      ) : null}
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you don't recognize this group, you can safely ignore this email.
      </Text>
    </EmailLayout>
  )
}

export async function renderInvitationEmail(
  input: InvitationEmailInput,
): Promise<RenderedEmail> {
  const webBase = getWebBaseUrl()
  const acceptUrl = `${webBase}/groups/${input.groupId}`
  const signInUrl = `${webBase}/?invitation=${input.invitationId}`

  const subject = input.temporaryName
    ? `${input.inviterDisplayName} invited you to ${input.groupName} on Spliit Cloud as ${input.temporaryName}`
    : `${input.inviterDisplayName} invited you to ${input.groupName} on Spliit Cloud`

  const text = buildInvitationText(input, { acceptUrl, signInUrl })

  return renderTemplate(
    <InvitationEmail
      {...input}
      acceptUrl={acceptUrl}
      signInUrl={signInUrl}
      brandBaseUrl={webBase}
    />,
    { subject, text },
  )
}

function buildInvitationText(
  input: InvitationEmailInput,
  urls: { acceptUrl: string; signInUrl: string },
): string {
  const lines: string[] = input.recipientIsExistingUser
    ? [
        `${input.inviterDisplayName} (${input.inviterRole.toLowerCase()}) invited you to join "${input.groupName}" on Spliit Cloud.`,
        ...(input.temporaryName
          ? [`You will appear as "${input.temporaryName}" in this group.`]
          : []),
        '',
        `Open Spliit Cloud to accept or decline the invitation:`,
        urls.acceptUrl,
      ]
    : [
        `${input.inviterDisplayName} invited you to join "${input.groupName}" on Spliit Cloud.`,
        ...(input.temporaryName
          ? [`You will appear as "${input.temporaryName}" in this group.`]
          : []),
        '',
        `Create an account to join the group:`,
        urls.signInUrl,
      ]

  if (input.sourceProvider) {
    const fromProvider =
      PROVIDER_LABELS[input.sourceProvider] ??
      `a ${input.sourceProvider.toLowerCase()} export`

    lines.push('', '---', '')
    lines.push(`This invitation is part of an import from ${fromProvider}.`)
    if (input.sourceGroupName) {
      lines.push(`Source group: ${input.sourceGroupName}`)
    }
    let expenseLine = ''
    if (input.expenseCount != null) {
      expenseLine += `The group contains ${input.expenseCount} expense${input.expenseCount === 1 ? '' : 's'} from the import`
    }
    if (input.totalAmount != null && input.currencyCode) {
      const formattedTotal = `${input.currencyCode} ${(input.totalAmount / 100).toFixed(2)}`
      expenseLine += ` (total ${formattedTotal})`
    }
    if (expenseLine) {
      expenseLine += '.'
      lines.push(expenseLine)
    }
  }

  lines.push(
    '',
    `If you don't recognize this group, you can safely ignore this email.`,
  )

  return lines.join('\n')
}
