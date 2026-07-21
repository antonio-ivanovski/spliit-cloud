import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'
import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

/** The content needed to render a non-invitation group activity message. */
export type GroupActivityEmailInput = {
  subject: string
  text: string
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  activityLabel: string
  summary?: string | null
  groupUrl: string
  unsubscribeUrl?: string
}

export function GroupActivityEmail(
  props: Omit<GroupActivityEmailInput, 'subject' | 'text'>,
): ReactElement {
  const preview = `${props.activityLabel} in ${props.groupDisplayName}`
  return (
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold text-[#0f172a] tracking-tight"
      >
        {props.activityLabel}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        <strong>{props.activityLabel}</strong> in{' '}
        <strong>{props.groupDisplayName}</strong> by{' '}
        <strong>{props.actorName}</strong>.
      </Text>
      {props.summary ? (
        <Section className="bg-[#f8fafc] border border-solid border-[#e5e7eb] rounded-md px-5 py-4 my-4">
          <Text className="m-0 text-[14px] leading-[22px] text-[#0f172a]">
            {props.summary}
          </Text>
        </Section>
      ) : null}
      <Section className="text-center my-6">
        <EmailButton href={props.groupUrl} label="View group" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={props.groupUrl} className="text-[#64748b] underline">
          {props.groupUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export async function renderGroupActivityEmail(
  input: GroupActivityEmailInput,
): Promise<RenderedEmail> {
  const { subject, text, ...componentProps } = input
  return renderTemplate(<GroupActivityEmail {...componentProps} />, {
    subject,
    text,
  })
}
