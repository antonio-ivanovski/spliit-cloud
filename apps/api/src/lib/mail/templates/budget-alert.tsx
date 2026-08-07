import { Heading, Link, Section, Text } from '@react-email/components'
import type { ReactElement } from 'react'

import { EmailButton } from './components/email-button'
import { EmailLayout } from './components/email-layout'
import { renderTemplate } from './render'
import type { RenderedEmail } from './types'

export type BudgetAlertInput = {
  kind: 'budget_alert'
  /** Pre-computed by the dispatcher. */
  subject: string
  text: string
  brandBaseUrl: string
  budgetName: string
  groupName: string
  /** Formatted used amount, e.g. "USD 120.00". */
  usedStr: string
  /** Formatted limit amount, e.g. "USD 200.00". */
  limitStr: string
  /** 0-100, clamped. */
  percentage: number
  /** Localized display value for the percentage, including its sign. */
  percentageLabel?: string
  /** Human-readable period range, e.g. "01.07 – 31.07". */
  periodRange: string
  alertType: 'TRENDING_OVER' | 'OVER'
  budgetUrl: string
  unsubscribeUrl?: string
}

export function BudgetAlertEmail(
  props: Omit<BudgetAlertInput, 'kind' | 'subject' | 'text'>,
): ReactElement {
  const isOver = props.alertType === 'OVER'
  const headline = isOver ? 'Budget exceeded' : 'Budget trending over'
  const accent = isOver ? '#dc2626' : '#d97706'
  const preview = `${props.budgetName}: ${props.usedStr} of ${props.limitStr} in ${props.groupName}`
  const barWidth = Math.max(0, Math.min(100, Math.round(props.percentage)))

  return (
    <EmailLayout
      preview={preview}
      brandBaseUrl={props.brandBaseUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Heading
        as="h1"
        className="m-0 mb-3 text-[22px] font-semibold tracking-tight text-[#0f172a]"
      >
        {headline}
      </Heading>
      <Text className="m-0 mb-4 text-[15px] leading-[22px] text-[#0f172a]">
        Your budget <strong>{props.budgetName}</strong> in{' '}
        <strong>{props.groupName}</strong> is{' '}
        {isOver ? 'over its limit' : 'on track to exceed its limit'}.
      </Text>

      <Section className="my-4 rounded-md border border-solid border-[#e5e7eb] bg-[#f8fafc] px-5 py-4">
        <Text className="m-0 text-[14px] leading-[22px] text-[#0f172a]">
          <strong>Spent:</strong>{' '}
          <span style={{ color: accent }}>{props.usedStr}</span> of{' '}
          {props.limitStr}
        </Text>
        {/* Email-safe progress bar built from nested tables. */}
        {/* oxlint-disable jsx-a11y/control-has-associated-label -- decorative email progress bar cells */}
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '12px',
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  width: '100%',
                  height: '10px',
                  backgroundColor: '#e2e8f0',
                  borderRadius: '9999px',
                  overflow: 'hidden',
                }}
              >
                <table
                  role="presentation"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ width: '100%', borderCollapse: 'collapse' }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          width: `${barWidth}%`,
                          height: '10px',
                          backgroundColor: accent,
                          borderRadius: '9999px',
                        }}
                      />
                      <td style={{ height: '10px' }} />
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
        <Text className="m-0 mt-3 text-[13px] leading-[20px] text-[#64748b]">
          {props.percentageLabel ?? `${barWidth}%`} used · Period:{' '}
          {props.periodRange}
        </Text>
      </Section>

      <Section className="my-6 text-center">
        <EmailButton href={props.budgetUrl} label="View budget" />
      </Section>
      <Text className="m-0 mb-2 text-[14px] leading-[22px] text-[#0f172a]">
        If the button doesn&apos;t work, copy and paste this URL into your
        browser:
      </Text>
      <Text className="m-0 mb-4 text-[13px] leading-[20px] break-all text-[#64748b]">
        <Link href={props.budgetUrl} className="text-[#64748b] underline">
          {props.budgetUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}

export async function renderBudgetAlertEmail(
  input: BudgetAlertInput,
): Promise<RenderedEmail> {
  const { kind: _kind, subject, text, ...componentProps } = input
  return renderTemplate(<BudgetAlertEmail {...componentProps} />, {
    subject,
    text,
  })
}
