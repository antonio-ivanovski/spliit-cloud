import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'

import { getWebBaseUrl } from '../../auth/urls'
import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

function settingsUrl(): string {
  return `${getWebBaseUrl()}/account/settings`
}

export function AccountDeletionRequestedEmail(props: {
  brandBaseUrl: string
  executeAtLabel: string
  keepDisplayName: boolean
  deletionUrl: string
  feedbackUrl: string
  exportUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud account deletion is scheduled"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your account deletion is scheduled
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Your Spliit Cloud account is scheduled for permanent deletion after a
        48-hour cancellation period. Your account stays active until deletion
        starts, on or after {props.executeAtLabel}.
      </Text>
      <Section className="my-4 rounded-md border border-solid border-[#e5e7eb] bg-[#f8fafc] px-5 py-4">
        <Text className="m-0 text-[14px] leading-[20px] text-[#0f172a]">
          <strong>When deletion runs:</strong> your profile, sessions, and
          personal settings are deleted. Expenses you shared with others stay in
          their groups so their balances keep working, but your name is{' '}
          {props.keepDisplayName
            ? 'kept using the name you chose for that shared history'
            : 'replaced with “Deleted member”'}
          .
        </Text>
      </Section>
      <Text className="m-0 mb-4 text-[14px] leading-[22px] text-[#0f172a]">
        Groups, members, and expenses can change during the waiting period. Your
        choices apply to your current groups and balances when deletion runs.
        Nothing is deleted or settled immediately. Once deletion starts, it
        cannot be cancelled or undone.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.deletionUrl} label="Review or cancel" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        You can cancel any time before deletion starts from the deletion page:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.deletionUrl} className="text-[#64748b] underline">
          {props.deletionUrl}
        </Link>
      </Text>
      <Text className="m-0 mb-4 text-[14px] leading-[22px] text-[#0f172a]">
        Want a copy first?{' '}
        <Link href={props.exportUrl} className="text-[#0f172a] underline">
          Export a backup
        </Link>{' '}
        before deletion starts.
      </Text>
      <Text className="m-0 mb-4 text-[14px] leading-[22px] text-[#0f172a]">
        If there is anything we can do so you stay,{' '}
        <Link href={props.feedbackUrl} className="text-[#0f172a] underline">
          share your feedback
        </Link>
        . It takes a minute and helps us improve.
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request this, cancel it and review your sign-in methods
        in account settings immediately.
      </Text>
    </EmailLayout>
  )
}

export function AccountDeletionCancelledEmail(props: {
  brandBaseUrl: string
  settingsUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud account deletion was cancelled"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your account deletion was cancelled
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        The pending deletion of your Spliit Cloud account was cancelled. Your
        account remains active and nothing was deleted.
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not cancel this, your account may be compromised — review
        your sign-in methods immediately from account settings:{' '}
        <Link href={props.settingsUrl} className="text-[#64748b] underline">
          {props.settingsUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function AccountDeletionExecutedEmail(props: {
  brandBaseUrl: string
}): ReactElement {
  return (
    <EmailLayout
      preview="Your Spliit Cloud account was deleted"
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        Your account was deleted
      </Heading>
      <Text className="m-0 mb-6 text-[15px] leading-[24px] text-[#0f172a]">
        Your Spliit Cloud account and all of its sign-in methods have been
        permanently deleted. Shared expense history in other members' groups was
        kept without your personal details.
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you did not request this, reply to this email to contact support.
      </Text>
    </EmailLayout>
  )
}

export async function renderAccountDeletionRequestedEmail(input: {
  executeAtLabel: string
  keepDisplayName: boolean
  deletionUrl?: string
}): Promise<RenderedEmail> {
  const baseUrl = getWebBaseUrl()
  const deletionUrl = input.deletionUrl ?? `${baseUrl}/account/delete`
  const feedbackUrl = `${baseUrl}/feedback`
  const exportUrl = `${baseUrl}/account/settings#account-export`
  const text =
    `Your Spliit Cloud account is scheduled for permanent deletion after a 48-hour cancellation period. ` +
    `Your account stays active until deletion starts, on or after ${input.executeAtLabel}.\n\n` +
    `When deletion runs: your profile, sessions, and personal settings are deleted. ` +
    `Expenses you shared with others stay in their groups so their balances keep working, but your name is ` +
    (input.keepDisplayName
      ? `kept using the name you chose for that shared history.`
      : `replaced with “Deleted member”.`) +
    `\n\nGroups, members, and expenses can change during the waiting period. Your choices apply to your current groups and balances when deletion runs. ` +
    `Nothing is deleted or settled immediately. Once deletion starts, it cannot be cancelled or undone.\n\n` +
    `You can cancel any time before deletion starts from the deletion page:\n${deletionUrl}\n\n` +
    `Want a copy first? Export a backup before deletion starts: ${exportUrl}\n\n` +
    `If there is anything we can do so you stay, share your feedback. It takes a minute and helps us improve: ${feedbackUrl}\n\n` +
    `If you did not request this, cancel it and review your sign-in methods in account settings immediately.`

  return renderTemplate(
    <AccountDeletionRequestedEmail
      brandBaseUrl={baseUrl}
      executeAtLabel={input.executeAtLabel}
      keepDisplayName={input.keepDisplayName}
      deletionUrl={deletionUrl}
      feedbackUrl={feedbackUrl}
      exportUrl={exportUrl}
    />,
    { subject: 'Your Spliit Cloud account deletion is scheduled', text },
  )
}

export async function renderAccountDeletionCancelledEmail(
  input: {
    settingsUrl?: string
  } = {},
): Promise<RenderedEmail> {
  const url = input.settingsUrl ?? settingsUrl()
  const text =
    `The pending deletion of your Spliit Cloud account was cancelled. ` +
    `Your account remains active and nothing was deleted.\n\n` +
    `If you did not cancel this, review your sign-in methods immediately from account settings: ${url}`

  return renderTemplate(
    <AccountDeletionCancelledEmail
      brandBaseUrl={getWebBaseUrl()}
      settingsUrl={url}
    />,
    { subject: 'Your Spliit Cloud account deletion was cancelled', text },
  )
}

export async function renderAccountDeletionExecutedEmail(): Promise<RenderedEmail> {
  const text =
    `Your Spliit Cloud account and all of its sign-in methods have been permanently deleted. ` +
    `Shared expense history in other members' groups was kept without your personal details.\n\n` +
    `If you did not request this, reply to this email to contact support.`

  return renderTemplate(
    <AccountDeletionExecutedEmail brandBaseUrl={getWebBaseUrl()} />,
    { subject: 'Your Spliit Cloud account was deleted', text },
  )
}
