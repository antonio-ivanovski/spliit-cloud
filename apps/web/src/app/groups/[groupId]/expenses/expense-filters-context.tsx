import { type PropsWithChildren, createContext, useContext } from 'react'
import type { useExpenseFilters } from './use-expense-filters'

type ExpenseFiltersContextValue = ReturnType<typeof useExpenseFilters>

const ExpenseFiltersContext = createContext<ExpenseFiltersContextValue | null>(
  null,
)

export function useExpenseFiltersContext(): ExpenseFiltersContextValue {
  const ctx = useContext(ExpenseFiltersContext)
  if (!ctx)
    throw new Error(
      'useExpenseFiltersContext must be used inside an ExpenseFiltersProvider.',
    )
  return ctx
}

export const ExpenseFiltersProvider = ({
  value,
  children,
}: PropsWithChildren<{ value: ExpenseFiltersContextValue }>) => {
  return (
    <ExpenseFiltersContext.Provider value={value}>
      {children}
    </ExpenseFiltersContext.Provider>
  )
}
