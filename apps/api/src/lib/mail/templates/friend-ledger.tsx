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
  unsubscribeUrl?: string
}): ReactElement {
  const label = props.isNewUser ? 'Create a free account' : 'Open Spliit Cloud'
  const preview = `${props.inviterName} started a friend ledger with you on Spliit Cloud`
  return (
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.webBase}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[24px] font-semibold tracking-tight text-[#0f172a]"
      >
        {props.inviterName} started a friend ledger with you
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]">
        {props.inviterName} started a friend ledger with you on Spliit Cloud.
        Use the button below to view it.
      </Text>
      <Section className="my-6 text-center">
        <EmailButton href={props.webBase} label={label} />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
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
  unsubscribeUrl?: string
}): Promise<RenderedEmail> {
  const webBase = getWebBaseUrl()
  const subject = `${input.inviterName} started a friend ledger with you on Spliit Cloud`

  const text = input.isNewUser
    ? `${input.inviterName} started a friend ledger with you.\n\n` +
      `Create a free Spliit Cloud account to get started:\n${webBase}\n\n` +
      `If you don't recognize this request, you can safely ignore this email.`
    : `${input.inviterName} started a friend ledger with you.\n\n` +
      `Open Spliit Cloud to see your new friend ledger:\n${webBase}\n\n` +
      `If you don't recognize this request, you can safely ignore this email.`

  return renderTemplate(
    <FriendLedgerEmail
      webBase={webBase}
      inviterName={input.inviterName}
      isNewUser={input.isNewUser}
      unsubscribeUrl={input.unsubscribeUrl}
    />,
    { subject, text },
  )
}
