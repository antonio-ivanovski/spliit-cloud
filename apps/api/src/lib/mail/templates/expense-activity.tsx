import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'
import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

export type ExpenseActivityInput = {
  kind: 'expense'
  /** Pre-computed by the dispatcher (per event type and recipient). */
  subject: string
  text: string
  eventType: 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'EXPENSE_DELETED'
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  title: string
  amountStr: string | null
  date: string | null
  changedFields?: string[]
  expenseUrl: string
}

export type ExpenseImportSummaryInput = {
  kind: 'import_summary'
  subject: string
  text: string
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  count: number
  sourceProvider: string | null
  totalStr: string | null
  groupUrl: string
}

export type ExpenseCategoryBulkSummaryInput = {
  kind: 'expense_categories_bulk_updated'
  subject: string
  text: string
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  count: number
  distinctCategories: number | null
  groupUrl: string
}

export type ExpenseActivityInputAny =
  | ExpenseActivityInput
  | ExpenseImportSummaryInput
  | ExpenseCategoryBulkSummaryInput

export function ExpenseActivityEmail(
  props: Omit<ExpenseActivityInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  const headline = expenseHeadline(
    props.eventType,
    props.actorName,
    props.title,
  )
  const preview = `${props.actorName} ${eventVerbPastParticiple(props.eventType)} "${props.title}"`
  return (
    <EmailLayout preview={preview} brandBaseUrl={props.brandBaseUrl}>
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold text-[#0f172a] tracking-tight"
      >
        {headline}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        in <strong>{props.groupDisplayName}</strong>
        {props.amountStr ? <> · {props.amountStr}</> : null}
        {props.date ? <> · {props.date}</> : null}.
      </Text>
      <Section className="bg-[#f8fafc] border border-solid border-[#e5e7eb] rounded-md px-5 py-4 my-4">
        <Text className="m-0 text-[14px] leading-[22px] text-[#0f172a]">
          <strong>Expense:</strong> "{props.title}"
        </Text>
        {props.amountStr ? (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#0f172a]">
            <strong>Amount:</strong> {props.amountStr}
          </Text>
        ) : null}
        {props.date ? (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#0f172a]">
            <strong>Date:</strong> {props.date}
          </Text>
        ) : null}
        {props.changedFields?.length ? (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#0f172a]">
            <strong>Changed:</strong> {props.changedFields.join(', ')}
          </Text>
        ) : null}
      </Section>
      <Section className="text-center my-6">
        <EmailButton
          href={props.expenseUrl}
          label={
            props.eventType === 'EXPENSE_DELETED'
              ? 'Open group'
              : 'View expense'
          }
        />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={props.expenseUrl} className="text-[#64748b] underline">
          {props.expenseUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function ExpenseImportSummaryEmail(
  props: Omit<ExpenseImportSummaryInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  const noun = props.count === 1 ? 'expense' : 'expenses'
  const preview = `${props.count} ${noun} imported into ${props.groupDisplayName}`
  const heading = `${props.count} ${noun[0].toUpperCase()}${noun.slice(1)} imported`
  return (
    <EmailLayout preview={preview} brandBaseUrl={props.brandBaseUrl}>
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold text-[#0f172a] tracking-tight"
      >
        {heading}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        <strong>{props.actorName}</strong> imported{' '}
        <strong>
          {props.count} {noun}
        </strong>
        {props.sourceProvider ? <> from {props.sourceProvider}</> : null} in{' '}
        <strong>{props.groupDisplayName}</strong>
        {props.totalStr ? <> (total {props.totalStr})</> : null}.
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.groupUrl} label="Open group" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={props.groupUrl} className="text-[#64748b] underline">
          {props.groupUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export function ExpenseCategoryBulkSummaryEmail(
  props: Omit<ExpenseCategoryBulkSummaryInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  const noun = props.count === 1 ? 'expense' : 'expenses'
  return (
    <EmailLayout
      preview={`${props.count} ${noun} recategorized in ${props.groupDisplayName}`}
      brandBaseUrl={props.brandBaseUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold text-[#0f172a] tracking-tight"
      >
        Expense categories updated
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        <strong>{props.actorName}</strong> updated categories for{' '}
        <strong>
          {props.count} {noun}
        </strong>{' '}
        in <strong>{props.groupDisplayName}</strong>
        {props.distinctCategories
          ? ` across ${props.distinctCategories} categories`
          : null}
        .
      </Text>
      <Section className="text-center my-6">
        <EmailButton href={props.groupUrl} label="Open group" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn't work, copy and paste this URL into your browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] text-[#64748b] break-all">
        <Link href={props.groupUrl} className="text-[#64748b] underline">
          {props.groupUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export async function renderExpenseActivityEmail(
  input: ExpenseActivityInputAny,
): Promise<RenderedEmail> {
  if (input.kind === 'expense') {
    const { kind: _kind, subject, text, ...componentProps } = input
    return renderTemplate(<ExpenseActivityEmail {...componentProps} />, {
      subject,
      text,
    })
  }
  if (input.kind === 'import_summary') {
    const { kind: _kind, subject, text, ...componentProps } = input
    return renderTemplate(<ExpenseImportSummaryEmail {...componentProps} />, {
      subject,
      text,
    })
  }
  const { kind: _kind, subject, text, ...componentProps } = input
  return renderTemplate(
    <ExpenseCategoryBulkSummaryEmail {...componentProps} />,
    { subject, text },
  )
}

function expenseHeadline(
  eventType: 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'EXPENSE_DELETED',
  actorName: string,
  title: string,
): string {
  switch (eventType) {
    case 'EXPENSE_CREATED':
      return `${actorName} added "${title}"`
    case 'EXPENSE_UPDATED':
      return `${actorName} updated "${title}"`
    case 'EXPENSE_DELETED':
      return `${actorName} removed "${title}"`
  }
}

function eventVerbPastParticiple(
  eventType: 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'EXPENSE_DELETED',
): string {
  switch (eventType) {
    case 'EXPENSE_CREATED':
      return 'added'
    case 'EXPENSE_UPDATED':
      return 'updated'
    case 'EXPENSE_DELETED':
      return 'removed'
  }
}
