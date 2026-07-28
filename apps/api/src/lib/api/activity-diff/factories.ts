import type { ActivityDiffer, DiffEmission } from './types'

// ---------------------------------------------------------------------------
// Simple differ factories
// ---------------------------------------------------------------------------

/**
 * Creates a differ for a simple string field where the value is compared
 * directly and displayed as-is.
 */
export function createStringFieldDiffer<
  TEntity,
  TField extends string,
  TContext,
  TEmission extends DiffEmission<TField> = DiffEmission<TField>,
>(config: {
  field: TField
  getValue: (value: TEntity) => string | null | undefined
}): ActivityDiffer<TEntity, TField, TContext, TEmission> {
  return {
    field: config.field,

    check(oldValue: TEntity, newValue: TEntity) {
      return (
        (config.getValue(oldValue) ?? null) !==
        (config.getValue(newValue) ?? null)
      )
    },

    diff(
      oldValue: TEntity,
      newValue: TEntity,
      _ctx: TContext,
    ): TEmission | null {
      if (!this.check(oldValue, newValue)) return null
      return {
        field: config.field,
        before: config.getValue(oldValue) ?? null,
        after: config.getValue(newValue) ?? null,
      } as TEmission
    },
  }
}

/**
 * Creates a differ for a field where comparison logic and formatting are
 * separated: `equals` defines semantic equality and `format` produces the
 * display value. When `equals` is omitted, the default behavior is to always
 * flag the field as changed (caller must handle comparison).
 */
export function createFormattedValueDiffer<
  TEntity,
  TField extends string,
  TContext,
  TEmission extends DiffEmission<TField> = DiffEmission<TField>,
>(config: {
  field: TField
  equals?: (oldValue: TEntity, newValue: TEntity) => boolean
  format: (value: TEntity, ctx: TContext) => string | null
}): ActivityDiffer<TEntity, TField, TContext, TEmission> {
  return {
    field: config.field,

    check(oldValue: TEntity, newValue: TEntity) {
      return !(config.equals?.(oldValue, newValue) ?? false)
    },

    diff(
      oldValue: TEntity,
      newValue: TEntity,
      ctx: TContext,
    ): TEmission | null {
      if (!this.check(oldValue, newValue)) return null
      return {
        field: config.field,
        before: config.format(oldValue, ctx),
        after: config.format(newValue, ctx),
      } as TEmission
    },
  }
}
