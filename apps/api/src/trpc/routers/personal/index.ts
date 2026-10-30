import { createTRPCRouter } from '../../init'
import { personalBudgetsRouter } from './budgets'
import { personalCategorizationRouter } from './categorization'
import { personalImportRouter } from './import'
import { personalOverviewRouter } from './overview'
import { personalProfileRouter } from './profile'
import { personalRecurringRouter } from './recurring'
import { personalExpensesRouter, personalSourcesRouter } from './sources'
import { personalTransactionsRouter } from './transactions'

export const personalRouter = createTRPCRouter({
  profile: personalProfileRouter,
  transactions: personalTransactionsRouter,
  recurring: personalRecurringRouter,
  overview: personalOverviewRouter,
  budgets: personalBudgetsRouter,
  import: personalImportRouter,
  sources: personalSourcesRouter,
  expenses: personalExpensesRouter,
  categorization: personalCategorizationRouter,
})
