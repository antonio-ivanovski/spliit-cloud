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
  eventType:
    | 'EXPENSE_CREATED'
    | 'RECURRING_EXPENSE_CREATED'
    | 'EXPENSE_UPDATED'
    | 'EXPENSE_DELETED'
    | 'RECURRING_EXPENSE_STOPPED'
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  title: string
  amountStr: string | null
  date: string | null
  changedFields?: string[]
  expenseUrl: string
  unsubscribeUrl?: string
  /** Human-readable recurrence description, e.g. "Monthly, 12 total". */
  recurrence?: string
  /** When true the recurrence was cancelled as part of this action. */
  stopped?: boolean
}

export type ExpenseCommentInput = {
  kind: 'expense_comment'
  subject: string
  text: string
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  title: string
  excerpt: string
  expenseUrl: string
  unsubscribeUrl?: string
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
  unsubscribeUrl?: string
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
  unsubscribeUrl?: string
}

export type RecurringExpenseSummaryInput = {
  kind: 'recurring_expense_summary'
  subject: string
  text: string
  brandBaseUrl: string
  groupDisplayName: string
  actorName: string
  title: string | null
  count: number
  startDate: string
  endDate: string
  groupUrl: string
  unsubscribeUrl?: string
  operation?: string
  stopped?: boolean
  recurrence?: string
}

export type ExpenseActivityInputAny =
  | ExpenseActivityInput
  | ExpenseCommentInput
  | ExpenseImportSummaryInput
  | ExpenseCategoryBulkSummaryInput
  | RecurringExpenseSummaryInput

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
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
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
        {props.recurrence ? (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#0f172a]">
            <strong>Repeats:</strong> {props.recurrence}
          </Text>
        ) : null}
        {props.stopped ? (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#0f172a]">
            <strong>Recurrence:</strong> stopped
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

export function ExpenseCommentEmail(
  props: Omit<ExpenseCommentInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  return (
    <EmailLayout
      preview={`${props.actorName} commented on "${props.title}"`}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold text-[#0f172a] tracking-tight"
      >
        {props.actorName} commented on &quot;{props.title}&quot;
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        in <strong>{props.groupDisplayName}</strong>.
      </Text>
      {props.excerpt ? (
        <Section className="bg-[#f8fafc] border border-solid border-[#e5e7eb] rounded-md px-5 py-4 my-4">
          <Text className="m-0 text-[14px] leading-[22px] text-[#0f172a]">
            &quot;{props.excerpt}&quot;
          </Text>
        </Section>
      ) : null}
      <Section className="text-center my-6">
        <EmailButton href={props.expenseUrl} label="View expense" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn&apos;t work, copy and paste this URL into your
        browser:
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
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
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
      unsubscribeUrl={props.unsubscribeUrl}
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

export function RecurringExpenseSummaryEmail(
  props: Omit<RecurringExpenseSummaryInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  const operation = props.operation ?? 'create'
  const noun = props.count === 1 ? 'expense' : 'expenses'
  const title = props.title ? ` "${props.title}"` : ''
  const verb =
    operation === 'update'
      ? 'updated'
      : operation === 'delete'
        ? 'removed'
        : 'added'
  const heading =
    operation === 'update'
      ? 'Recurring expenses updated'
      : operation === 'delete'
        ? 'Recurring expenses removed'
        : 'Recurring expenses caught up'
  const preview =
    operation === 'update'
      ? `${props.count} recurring ${noun} updated in ${props.groupDisplayName}`
      : operation === 'delete'
        ? `${props.count} recurring ${noun} removed from ${props.groupDisplayName}`
        : `${props.count} recurring ${noun} caught up in ${props.groupDisplayName}`
  const recurrenceDesc = props.recurrence ? ` (${props.recurrence})` : ''
  const stoppedSuffix = props.stopped ? ' and the recurrence was stopped' : ''
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
        {heading}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        <strong>{props.actorName}</strong> {verb}{' '}
        <strong>
          {props.count} recurring {noun}
        </strong>
        {title}
        {recurrenceDesc} in <strong>{props.groupDisplayName}</strong> for{' '}
        {props.startDate} through {props.endDate}
        {stoppedSuffix}.
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
  if (input.kind === 'expense_comment') {
    const { kind: _kind, subject, text, ...componentProps } = input
    return renderTemplate(<ExpenseCommentEmail {...componentProps} />, {
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
  if (input.kind === 'recurring_expense_summary') {
    const { kind: _kind, subject, text, ...componentProps } = input
    return renderTemplate(
      <RecurringExpenseSummaryEmail {...componentProps} />,
      {
        subject,
        text,
      },
    )
  }
  const { kind: _kind, subject, text, ...componentProps } = input
  return renderTemplate(
    <ExpenseCategoryBulkSummaryEmail {...componentProps} />,
    { subject, text },
  )
}

function expenseHeadline(
  eventType:
    | 'EXPENSE_CREATED'
    | 'RECURRING_EXPENSE_CREATED'
    | 'EXPENSE_UPDATED'
    | 'EXPENSE_DELETED'
    | 'RECURRING_EXPENSE_STOPPED',
  actorName: string,
  title: string,
): string {
  switch (eventType) {
    case 'EXPENSE_CREATED':
      return `${actorName} added "${title}"`
    case 'RECURRING_EXPENSE_CREATED':
      return `${actorName} created recurring "${title}"`
    case 'EXPENSE_UPDATED':
      return `${actorName} updated "${title}"`
    case 'EXPENSE_DELETED':
      return `${actorName} removed "${title}"`
    case 'RECURRING_EXPENSE_STOPPED':
      return `${actorName} stopped recurring "${title}"`
  }
}

function eventVerbPastParticiple(
  eventType:
    | 'EXPENSE_CREATED'
    | 'RECURRING_EXPENSE_CREATED'
    | 'EXPENSE_UPDATED'
    | 'EXPENSE_DELETED'
    | 'RECURRING_EXPENSE_STOPPED',
): string {
  switch (eventType) {
    case 'EXPENSE_CREATED':
      return 'added'
    case 'RECURRING_EXPENSE_CREATED':
      return 'created recurring'
    case 'EXPENSE_UPDATED':
      return 'updated'
    case 'EXPENSE_DELETED':
      return 'removed'
    case 'RECURRING_EXPENSE_STOPPED':
      return 'stopped'
  }
}
