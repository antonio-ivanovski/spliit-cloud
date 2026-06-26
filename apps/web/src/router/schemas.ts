import { categoryIdSchema } from '@spliit/domain'
import { z } from 'zod'

/**
 * Path-param and search-param schemas for every route that needs typed
 * values. These are wired up via `params.parse` / `validateSearch` on each
 * `createFileRoute(...)` definition, so consumers can call
 * `Route.useParams()` / `Route.useSearch()` (or `getRouteApi(...).useParams()`
 * / `.useSearch()` from code-split files) and get strongly-typed values out
 * of the URL.
 *
 * The route shapes here are intentionally permissive (`z.string().catch(...)`
 * for free-form fields, `z.optional()` for everything) so that an
 * out-of-band navigation never throws a `PathParamError` / `SearchParamError`
 * at the user — the page just renders with sensible defaults.
 */

const cuidLike = z.string().min(1).catch('')

export const groupIdParamSchema = cuidLike
export const expenseIdParamSchema = cuidLike

/**
 * Search-param schema for the `/groups/$groupId` route. The `invite`
 * field carries a link-invite token. Any string (or absence) is
 * captured and forwarded to the server, which is the source of truth
 * for token validity — malformed or empty tokens are rejected with
 * FORBIDDEN, rendered as the "invalid link" page by the layout.
 */
export const groupSearchSchema = z.object({
  invite: z.string().optional(),
})

export const groupParamsSchema = z.object({
  groupId: groupIdParamSchema,
})

export const expenseParamsSchema = z.object({
  groupId: groupIdParamSchema,
  expenseId: expenseIdParamSchema,
})

const optionalString = z.string().optional().catch(undefined)

export const homeSearchSchema = z.object({
  redirect: optionalString,
  mode: z.enum(['sign-in', 'sign-up']).optional().catch(undefined),
  email: optionalString,
})

export const forgotPasswordSearchSchema = z.object({
  email: optionalString,
})

export const resetPasswordSearchSchema = z.object({
  token: optionalString,
  error: optionalString,
})

export const completeProfileSearchSchema = z.object({
  redirect: optionalString,
})

const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'expected a numeric string')
  .optional()
  .catch(undefined)

const integerString = z
  .string()
  .regex(/^-?\d+$/, 'expected an integer string')
  .optional()
  .catch(undefined)

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'expected an ISO date')
  .optional()
  .catch(undefined)

export const createExpenseSearchSchema = z.object({
  reimbursement: optionalString,
  amount: numericString,
  from: optionalString,
  to: optionalString,
  title: optionalString,
  date: dateString,
  categoryId: categoryIdSchema.optional().catch(undefined),
  imageUrl: optionalString,
  imageWidth: integerString,
  imageHeight: integerString,
})

export type CreateExpenseSearch = z.infer<typeof createExpenseSearchSchema>
export type CompleteProfileSearch = z.infer<typeof completeProfileSearchSchema>
export type ResetPasswordSearch = z.infer<typeof resetPasswordSearchSchema>
export type ForgotPasswordSearch = z.infer<typeof forgotPasswordSearchSchema>
export type HomeSearch = z.infer<typeof homeSearchSchema>
