import { useQuery } from '@tanstack/react-query'
import { Loader2, Printer } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { getApiBaseUrl } from '@/lib/api-url'
import type { ExpenseReportViewModel } from '@spliit/api/lib/report/format'

import { buildReportLabels } from './report-labels'

import './report-print.css'

type ReportPrintPageProps = {
  groupId: string
  from: string
  to: string
}

type ReportDataQueryInput = ReportPrintPageProps & {
  locale: string
  labels: ReturnType<typeof buildReportLabels>
}

async function fetchReportData(
  input: ReportDataQueryInput,
  signal: AbortSignal,
): Promise<ExpenseReportViewModel> {
  const response = await fetch(
    `${getApiBaseUrl()}/groups/${encodeURIComponent(input.groupId)}/expenses/report-data`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        locale: input.locale,
        labels: input.labels,
      }),
      signal,
    },
  )

  if (!response.ok) throw new Error('Report data request failed')
  return (await response.json()) as ExpenseReportViewModel
}

function buildPrintDocumentTitle(
  groupName: string,
  reportTitle: string,
  from: string,
  to: string,
) {
  const safeGroupName = groupName
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  return `Spliit Cloud - ${safeGroupName || 'Group'} - ${reportTitle} (${from} to ${to})`
}

function AmountList({
  items,
}: {
  items: Array<{ name: string; amount: string }>
}) {
  return (
    <ul className="print-report-split">
      {items.map((item, index) => (
        <li key={`${item.name}-${item.amount}-${index}`}>
          <span>{item.name}</span>
          <span>{item.amount}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionHeading({
  children,
  meta,
}: {
  children: string
  meta?: string
}) {
  return (
    <h2 className="print-report-section-heading">
      <span>{children}</span>
      {meta ? <span className="print-report-section-meta">{meta}</span> : null}
    </h2>
  )
}

function ParticipantTable({ report }: { report: ExpenseReportViewModel }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseReport' })
  return report.participants.length > 0 ? (
    <table className="print-report-table">
      <thead>
        <tr>
          <th>{t('participantColumnLabel')}</th>
          <th className="numeric">{t('paidColumnLabel')}</th>
          <th className="numeric">{t('shareColumnLabel')}</th>
          <th className="numeric">{t('balanceColumnLabel')}</th>
        </tr>
      </thead>
      <tbody>
        {report.participants.map((participant) => (
          <tr key={participant.name}>
            <td className="strong">{participant.name}</td>
            <td className="numeric">{participant.paid}</td>
            <td className="numeric">{participant.share}</td>
            <td className="numeric">{participant.balance}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="print-report-empty">{t('noParticipantsLabel')}</p>
  )
}

function SettlementsTable({ report }: { report: ExpenseReportViewModel }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseReport' })
  return report.settlements.length > 0 ? (
    <table className="print-report-table">
      <thead>
        <tr>
          <th>{t('fromColumnLabel')}</th>
          <th>{t('toColumnLabel')}</th>
          <th className="numeric">{t('amountColumnLabel')}</th>
        </tr>
      </thead>
      <tbody>
        {report.settlements.map((settlement, index) => (
          <tr key={`${settlement.from}-${settlement.to}-${index}`}>
            <td>{settlement.from}</td>
            <td>{settlement.to}</td>
            <td className="numeric strong">{settlement.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="print-report-empty">{t('noSettlementsLabel')}</p>
  )
}

function ReimbursementsTable({ report }: { report: ExpenseReportViewModel }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseReport' })
  return report.reimbursements.length > 0 ? (
    <table className="print-report-table">
      <thead>
        <tr>
          <th>{t('dateColumnLabel')}</th>
          <th>{t('fromColumnLabel')}</th>
          <th>{t('toColumnLabel')}</th>
          <th className="numeric">{t('amountColumnLabel')}</th>
        </tr>
      </thead>
      <tbody>
        {report.reimbursements.map((reimbursement, index) => (
          <tr key={`${reimbursement.date}-${reimbursement.amount}-${index}`}>
            <td>{reimbursement.date}</td>
            <td>{reimbursement.from}</td>
            <td>{reimbursement.to}</td>
            <td className="numeric strong">{reimbursement.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="print-report-empty">{t('noReimbursementsLabel')}</p>
  )
}

function ExpenseTable({ report }: { report: ExpenseReportViewModel }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseReport' })
  return report.expenses.length > 0 ? (
    <table className="print-report-table print-report-expenses-table">
      <colgroup>
        <col style={{ width: '11%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '30%' }} />
        <col style={{ width: '11%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>{t('dateColumnLabel')}</th>
          <th>{t('expenseColumnLabel')}</th>
          <th>{t('categoryColumnLabel')}</th>
          <th>{t('paidColumnLabel')}</th>
          <th>{t('splitLabel')}</th>
          <th className="numeric">{t('amountColumnLabel')}</th>
        </tr>
      </thead>
      <tbody>
        {report.expenses.map((expense) => (
          <tr key={expense.id}>
            <td>{expense.date}</td>
            <td className="strong">{expense.title}</td>
            <td>{expense.category}</td>
            <td>
              <AmountList items={expense.payers} />
            </td>
            <td>
              <AmountList items={expense.shares} />
              {expense.conversionNote ? (
                <div className="print-report-note">
                  {expense.conversionNote}
                </div>
              ) : null}
            </td>
            <td className="numeric strong">{expense.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="print-report-empty">{t('noExpensesLabel')}</p>
  )
}

export function ReportPrintPage({ groupId, from, to }: ReportPrintPageProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { t: tReport } = useTranslation(undefined, {
    keyPrefix: 'ExpenseReport',
  })
  const locale = useLocale()
  const labels = useMemo(() => buildReportLabels(tReport), [tReport])
  const reportQuery = useQuery({
    queryKey: ['expense-report', { groupId, from, to, locale, labels }],
    queryFn: ({ signal }) =>
      fetchReportData({ groupId, from, to, locale, labels }, signal),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const report = reportQuery.data

  useEffect(() => {
    document.body.dataset.printReport = 'true'
    return () => {
      delete document.body.dataset.printReport
    }
  }, [])

  useEffect(() => {
    if (!report) return
    document.title = buildPrintDocumentTitle(
      report.groupName,
      report.title,
      from,
      to,
    )
  }, [from, report, to])

  useEffect(() => {
    if (!report || typeof window.print !== 'function') return
    const timer = window.setTimeout(() => window.print(), 250)
    return () => window.clearTimeout(timer)
  }, [report])

  if (reportQuery.isPending) {
    return (
      <main className="print-report-shell grid place-items-center px-4 py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t('exportPdfGenerating')}</span>
        </div>
      </main>
    )
  }

  if (reportQuery.isError || !report) {
    return (
      <main className="print-report-shell grid place-items-center px-4 py-16">
        <p role="alert" className="text-sm text-destructive">
          {t('exportPdfError')}
        </p>
      </main>
    )
  }

  return (
    <main
      className="print-report-shell"
      dir={report.direction}
      aria-label={report.title}
    >
      <article className="print-report-sheet">
        <div className="print-report-toolbar no-print">
          <Button type="button" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" aria-hidden />
            {t('exportPdfAction')}
          </Button>
        </div>

        <header>
          <img
            className="print-report-brand"
            src="/logo-with-text.svg"
            alt="Spliit Cloud"
          />
          <p className="print-report-eyebrow">{report.title}</p>
          <h1 className="print-report-title">{report.groupName}</h1>
          <p className="print-report-meta">
            {labels.periodLabel}: {report.periodRange} ·{' '}
            {labels.balanceAsOfLabel}: {report.asOfDate} ·{' '}
            {labels.generatedOnLabel}: {report.generatedOn}
          </p>
          <hr className="print-report-rule" />
        </header>

        <p className="print-report-summary">
          <strong>
            {labels.totalSpentLabel} {report.metrics.total}
          </strong>
          <span aria-hidden>·</span>
          <span>
            {report.metrics.expenseCount} {labels.expensesCountLabel}
          </span>
          <span aria-hidden>·</span>
          <span>
            {report.metrics.participantCount} {labels.participantsCountLabel}
          </span>
        </p>

        <section className="print-report-section">
          <SectionHeading>{labels.participantsSectionLabel}</SectionHeading>
          <ParticipantTable report={report} />
        </section>

        <section className="print-report-section">
          <SectionHeading
            meta={`${labels.balanceAsOfLabel}: ${report.asOfDate}`}
          >
            {labels.settlementsSectionLabel}
          </SectionHeading>
          <SettlementsTable report={report} />
        </section>

        <section className="print-report-section">
          <SectionHeading>{labels.reimbursementsSectionLabel}</SectionHeading>
          <ReimbursementsTable report={report} />
        </section>

        <section className="print-report-section">
          <SectionHeading>{labels.expensesSectionLabel}</SectionHeading>
          <ExpenseTable report={report} />
        </section>
      </article>
    </main>
  )
}
