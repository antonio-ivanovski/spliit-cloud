import type { ActivityDiffer, DiffEmission } from './types'

// ---------------------------------------------------------------------------
// Generic composite differ factory
// ---------------------------------------------------------------------------

/**
 * Create a composite differ that iterates through all child differs and
 * collects results. This is the composition root for the diff pipeline.
 *
 * Each child differ is independently testable; the composite is tested with
 * smoke-level integration tests.
 */
export function createCompositeDiffer<
  TEntity,
  TField extends string,
  TContext,
  TEmission extends DiffEmission<TField>,
>(differs: ActivityDiffer<TEntity, TField, TContext, TEmission>[]) {
  return {
    /** Returns the ordered list of child differs. */
    getDiffers(): ReadonlyArray<
      ActivityDiffer<TEntity, TField, TContext, TEmission>
    > {
      return differs
    },

    /**
     * Run all child differs' `check()` methods and return changed field names.
     * Returns `null` when nothing changed.
     */
    changedFields(oldValue: TEntity, newValue: TEntity): TField[] | null {
      const fields = differs
        .filter((d) => d.check(oldValue, newValue))
        .map((d) => d.field)
      return fields.length > 0 ? fields : null
    },

    /**
     * Run all child differs' `diff()` methods and collect emissions. Returns
     * `null` when nothing changed.
     */
    changeSummary(
      oldValue: TEntity,
      newValue: TEntity,
      ctx: TContext,
    ): TEmission[] | null {
      const changes = differs
        .map((d) => d.diff(oldValue, newValue, ctx))
        .filter((change): change is TEmission => change !== null)
      return changes.length > 0 ? changes : null
    },
  }
}
