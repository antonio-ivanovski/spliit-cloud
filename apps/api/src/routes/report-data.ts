import { z } from 'zod'

import { prisma } from '@spliit/db'
import { locales } from '@spliit/domain'

import { getApplicationAuthFromRequest } from '../lib/auth/session'
import { isDateRangeValid, parseReportDate } from '../lib/report/dates'
import { formatExpenseReport } from '../lib/report/format'
import { reportLabelsSchema } from '../lib/report/labels'
import { loadExpenseReportData } from '../lib/report/loader'
import { buildExpenseReport } from '../lib/report/model'

const reportDataRequestSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  locale: z.enum(locales),
  labels: reportLabelsSchema,
})

async function parseRequestBody(request: Request) {
  try {
    const raw = await request.json()
    const parsed = reportDataRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        error: 'Invalid report request',
        issues: parsed.error.issues,
      } as const
    }
    return { body: parsed.data } as const
  } catch {
    return { error: 'Invalid JSON body' } as const
  }
}

/**
 * Return the localized, renderer-agnostic report view used by the browser print
 * page. Financial calculations remain on the API; the browser only lays out the
 * already-formatted strings with HTML/CSS.
 */
export async function reportGroupData(request: Request, groupId: string) {
  const { auth, response } = await getApplicationAuthFromRequest(request)
  if (response) return response

  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: auth.user.id } },
    select: { status: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = await parseRequestBody(request)
  if (!parsed.body) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const { from, to, locale, labels } = parsed.body

  let fromDate: Date
  let toDate: Date
  try {
    fromDate = parseReportDate(from)
    toDate = parseReportDate(to)
  } catch {
    return Response.json({ error: 'Invalid date' }, { status: 400 })
  }
  if (!isDateRangeValid(fromDate, toDate)) {
    return Response.json(
      { error: '`from` must not be after `to`' },
      { status: 400 },
    )
  }

  const data = await loadExpenseReportData({
    groupId,
    from: fromDate,
    to: toDate,
  })
  if (!data) {
    return Response.json({ error: 'Invalid group ID' }, { status: 404 })
  }

  const model = buildExpenseReport({
    groupName: data.group.groupName,
    currencyCode: data.group.currencyCode,
    currencySymbol: data.group.currencySymbol,
    currencyDecimalDigits: data.group.currencyDecimalDigits,
    from: fromDate,
    to: toDate,
    rows: data.rows,
    participants: data.participants,
  })
  const view = formatExpenseReport(model, locale, labels)

  return Response.json(view, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
