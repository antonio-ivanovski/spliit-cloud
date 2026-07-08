import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'
import { getWebBaseUrl } from '../../auth/urls'
import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

export function FriendLedgerEmail(props: {
  webBase: string
  inviterName: string
  isNewUser: boolean
}): ReactElement {
  const label = props.isNewUser ? 'Create a free account' : 'Open Spliit Cloud'
  const preview = `${props.inviterName} added you as a friend on Spliit Cloud`
  return (
    <EmailLayout preview={preview} brandBaseUrl={props.webBase}>
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold text-[#0f172a] tracking-tight"
      >
        {props.inviterName} added you as a friend
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        {props.inviterName} would like to track shared expenses with you on
        Spliit Cloud. Use the button below to view the new friend ledger.
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.webBase} label={label} />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={props.webBase} className="text-[#64748b] underline">
          {props.webBase}
        </Link>
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b]">
        If you don't recognize this request, you can safely ignore this email.
      </Text>
    </EmailLayout>
  )
}

export async function renderFriendLedgerEmail(input: {
  inviterName: string
  isNewUser: boolean
}): Promise<RenderedEmail> {
  const webBase = getWebBaseUrl()
  const subject = `${input.inviterName} added you as a friend on Spliit Cloud`

  const text = input.isNewUser
    ? `${input.inviterName} would like to track shared expenses with you.\n\n` +
      `Create a free Spliit Cloud account to get started:\n${webBase}\n\n` +
      `If you don't recognize this request, you can safely ignore this email.`
    : `${input.inviterName} would like to track shared expenses with you.\n\n` +
      `Open Spliit Cloud to see your new friend ledger:\n${webBase}\n\n` +
      `If you don't recognize this request, you can safely ignore this email.`

  return renderTemplate(
    <FriendLedgerEmail
      webBase={webBase}
      inviterName={input.inviterName}
      isNewUser={input.isNewUser}
    />,
    { subject, text },
  )
}
