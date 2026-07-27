import { z } from 'zod'

const balanceSchema = z.object({
  paid: z.number().int(),
  paidFor: z.number().int(),
  total: z.number().int(),
})

const reimbursementSchema = z.object({
  from: z.string(),
  to: z.string(),
  amount: z.number().int(),
})

const balancesRecordSchema = z.record(z.string(), balanceSchema)

export const listBalancesOutputSchema = z.object({
  balances: balancesRecordSchema,
  reimbursements: z.array(reimbursementSchema),
  currencyBalances: z.array(
    z.object({
      currencyCode: z.string(),
      balances: balancesRecordSchema,
      reimbursements: z.array(reimbursementSchema),
    }),
  ),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      removed: z.boolean(),
    }),
  ),
})
