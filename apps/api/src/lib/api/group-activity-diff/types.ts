import type { GroupChangedField } from '@spliit/domain/activities'

export type DiffableGroup = {
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
}

export type GroupChangeContext = Record<string, never>

export type GroupDiffEmission = {
  field: GroupChangedField
  before?: string | null
  after?: string | null
}

export interface GroupDiffer {
  readonly field: GroupChangedField
  check(oldGroup: DiffableGroup, newGroup: DiffableGroup): boolean
  diff(
    oldGroup: DiffableGroup,
    newGroup: DiffableGroup,
    ctx: GroupChangeContext,
  ): GroupDiffEmission | null
}
