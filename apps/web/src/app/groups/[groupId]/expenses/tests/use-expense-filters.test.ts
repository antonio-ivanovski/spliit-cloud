import { shouldPageByInvolvement } from '@/app/groups/[groupId]/expenses/use-expense-filters'

describe('shouldPageByInvolvement', () => {
  it('requests involving pages exactly when the timeline collapses', () => {
    // Identified viewer, default collapsed view.
    expect(shouldPageByInvolvement(true, false)).toBe(true)
    // Show-all renders everything: raw slices.
    expect(shouldPageByInvolvement(true, true)).toBe(false)
    // No identity (logged-out viewKey/invitee): server could not resolve
    // involvement anyway, and the timeline shows everything.
    expect(shouldPageByInvolvement(false, false)).toBe(false)
    expect(shouldPageByInvolvement(false, true)).toBe(false)
  })
})
