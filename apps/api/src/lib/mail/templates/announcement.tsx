import { Heading, Hr, Link, Section, Text } from '@react-email/components'
import type { ReactElement, ReactNode } from 'react'

import { parseAnnouncementBlocks } from '@spliit/domain/announcements/markdown'

import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

export type AnnouncementEmailInput = {
  subject: string
  text: string
  title: string
  body: string
  brandBaseUrl: string
  updatesUrl: string
  unsubscribeUrl?: string
}

function renderFormattedInline(value: string, keyPrefix: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*)/g)
  const nodes: ReactNode[] = []
  let key = 0
  for (const part of parts) {
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) {
      nodes.push(
        <strong key={`${keyPrefix}-b${key++}`}>
          {renderEmphasis(bold[1]!, `${keyPrefix}-b${key}`)}
        </strong>,
      )
      continue
    }
    nodes.push(...renderEmphasis(part, `${keyPrefix}-e${key++}`))
  }
  return nodes
}

function renderEmphasis(value: string, keyPrefix: string): ReactNode[] {
  const parts = value.split(/((?:^|[^*_])\*(?:[^*]+)\*|(?:^|[^_])_[^_]+_)/g)
  if (parts.length === 1) return renderCode(parts[0]!, keyPrefix)
  const nodes: ReactNode[] = []
  let key = 0
  for (const part of parts) {
    const star = part.match(/^(^|[^*_])\*([^*\n]+)\*$/)
    const underscore = part.match(/^(^|[^_])_([^_\n]+)_$/)
    const inner = star?.[2] ?? underscore?.[2]
    const lead = (star?.[1] ?? underscore?.[1] ?? '') || ''
    if (inner !== undefined) {
      if (lead) nodes.push(<span key={`${keyPrefix}-l${key++}`}>{lead}</span>)
      nodes.push(
        <em key={`${keyPrefix}-i${key++}`}>
          {renderCode(inner, `${keyPrefix}-i${key}`)}
        </em>,
      )
    } else {
      nodes.push(...renderCode(part, `${keyPrefix}-t${key++}`))
    }
  }
  return nodes
}

function renderCode(value: string, keyPrefix: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`)/g)
  if (parts.length === 1) return [parts[0] as ReactNode]
  return parts.map((part, index) => {
    const code = part.match(/^`([^`]+)`$/)
    if (!code) return <span key={`${keyPrefix}-c${index}`}>{part}</span>
    return (
      <code
        key={`${keyPrefix}-c${index}`}
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          backgroundColor: '#f1f5f9',
          padding: '1px 5px',
          borderRadius: '4px',
        }}
      >
        {code[1]}
      </code>
    )
  })
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const linkPattern = /\[([^\]]+)\]\((https:\/\/[^\s)<>"]+)\)/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  const pushText = (text: string) => {
    if (!text) return
    const urlPattern = /(https:\/\/[^\s)<>"]+)/g
    let last = 0
    let urlMatch: RegExpExecArray | null
    while ((urlMatch = urlPattern.exec(text)) !== null) {
      if (urlMatch.index > last) {
        nodes.push(
          ...renderFormattedInline(
            text.slice(last, urlMatch.index),
            `${keyPrefix}-t${key++}`,
          ),
        )
      }
      const url = urlMatch[1]!
      nodes.push(
        <Link
          key={`${keyPrefix}-u${key++}`}
          href={url}
          className="text-[#04785b] underline"
        >
          {url}
        </Link>,
      )
      last = urlMatch.index + urlMatch[0].length
    }
    if (last < text.length) {
      nodes.push(
        ...renderFormattedInline(text.slice(last), `${keyPrefix}-t${key++}`),
      )
    }
  }
  while ((match = linkPattern.exec(value)) !== null) {
    if (match.index > lastIndex) pushText(value.slice(lastIndex, match.index))
    const [, label, url] = match
    nodes.push(
      <Link
        key={`${keyPrefix}-l${key++}`}
        href={url}
        className="text-[#04785b] underline"
      >
        {renderFormattedInline(label!, `${keyPrefix}-ll${key}`)}
      </Link>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < value.length) pushText(value.slice(lastIndex))
  return nodes
}

export function AnnouncementEmail(
  props: Omit<AnnouncementEmailInput, 'subject' | 'text'>,
): ReactElement {
  const blocks = parseAnnouncementBlocks(props.body)
  const firstH2Index = blocks.findIndex(
    (block) => block.type === 'heading' && block.level === 2,
  )
  let key = 0
  return (
    <EmailLayout
      preview={props.title}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-4 text-[22px] font-semibold tracking-tight text-[#0f172a]"
      >
        {props.title}
      </Heading>
      {blocks.map((block, blockIndex) => {
        const id = key++
        // Body h1 renders as h2: the email title is already the h1, so a
        // body h1 would duplicate it and break the outline hierarchy.
        if (block.type === 'heading' && block.level <= 2) {
          const rule =
            blockIndex === firstH2Index ? null : (
              <Hr
                key={`rule-${id}`}
                className="my-6 border-t border-none border-solid border-[#e5e7eb]"
              />
            )
          return (
            <span key={`h2-${id}`}>
              {rule}
              <Heading
                as="h2"
                className="m-0 mb-2 text-[18px] font-semibold tracking-tight text-[#0f172a]"
              >
                {renderInline(block.text, `h2-${id}`)}
              </Heading>
            </span>
          )
        }
        if (block.type === 'heading') {
          return (
            <Heading
              key={`h3-${id}`}
              as="h3"
              className="m-0 mt-4 mb-2 text-[16px] font-semibold tracking-tight text-[#0f172a]"
            >
              {renderInline(block.text, `h3-${id}`)}
            </Heading>
          )
        }
        if (block.type === 'list') {
          return (
            <Section key={`list-${id}`} className="my-3">
              {block.items.map((item, index) => (
                <Text
                  key={`li-${id}-${index}`}
                  className="m-0 mb-1 text-[15px] leading-[24px] text-[#0f172a]"
                >
                  {block.ordered ? `${index + 1}. ` : '• '}
                  {renderInline(item, `li-${id}-${index}`)}
                </Text>
              ))}
            </Section>
          )
        }
        return (
          <Text
            key={`p-${id}`}
            className="m-0 mb-4 text-[15px] leading-[24px] text-[#0f172a]"
          >
            {renderInline(block.text, `p-${id}`)}
          </Text>
        )
      })}
      <Section className="my-6 text-center">
        <EmailButton href={props.updatesUrl} label="See all updates" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn&apos;t work, copy and paste this URL into your
        browser:
      </Text>
      <Text className="m-0 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.updatesUrl} className="text-[#64748b] underline">
          {props.updatesUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export async function renderAnnouncementEmailTemplate(
  input: AnnouncementEmailInput,
): Promise<RenderedEmail> {
  const { subject, text, ...componentProps } = input
  return renderTemplate(<AnnouncementEmail {...componentProps} />, {
    subject,
    text,
  })
}
