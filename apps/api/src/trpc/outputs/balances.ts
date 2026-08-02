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

const settlementUnitSchema = z.object({
  kind: z.enum(['subgroup', 'participant']),
  id: z.string(),
  name: z.string(),
  memberIds: z.array(z.string()),
  total: z.number().int(),
})

const settlementLegSchema = z.object({
  from: z.object({
    kind: z.enum(['subgroup', 'participant']),
    id: z.string(),
  }),
  to: z.object({
    kind: z.enum(['subgroup', 'participant']),
    id: z.string(),
  }),
  fromMemberIds: z.array(z.string()),
  toMemberIds: z.array(z.string()),
  amount: z.number().int(),
  payerId: z.string(),
  receiverId: z.string(),
})

const subgroupSettlementPlanSchema = z.object({
  units: z.array(settlementUnitSchema),
  legs: z.array(settlementLegSchema),
  hasInternalBalances: z.boolean(),
})

const individualSettlementPlanSchema = z.object({
  reimbursements: z.array(reimbursementSchema),
  policy: z.enum(['standard', 'within-subgroups', 'all-individual']),
})

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
  settlement: z.object({
    subgroup: subgroupSettlementPlanSchema,
    individual: individualSettlementPlanSchema,
  }),
})
