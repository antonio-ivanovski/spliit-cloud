// ---------------------------------------------------------------------------
// Generic / shared types for activity diffs
// ---------------------------------------------------------------------------

/**
 * A single diff emission produced by one narrow-purpose differ. TField is the
 * discriminated field union (e.g. ExpenseChangedField).
 */
export type DiffEmission<TField extends string = string> = {
  field: TField
  before?: string | null
  after?: string | null
}

/**
 * A self-contained differ that detects and formats changes for a single field
 * group. Each differ has a single narrow responsibility.
 *
 * Differ objects are plain objects — no classes — that are composed by a
 * composite differ which iterates through them collecting emissions.
 */
export interface ActivityDiffer<
  TEntity,
  TField extends string,
  TContext,
  TEmission extends DiffEmission<TField> = DiffEmission<TField>,
> {
  /** The field group this differ is responsible for. */
  readonly field: TField

  /**
   * Lightweight change detection — returns `true` when the field has
   * semantically meaningful differences. No context needed.
   */
  check(oldValue: TEntity, newValue: TEntity): boolean

  /**
   * Full diff: returns a human-readable emission when the field changed, or
   * `null` when it has not.
   */
  diff(oldValue: TEntity, newValue: TEntity, ctx: TContext): TEmission | null
}
