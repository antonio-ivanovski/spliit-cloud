import { createTRPCProxyClient, httpLink, TRPCClientError } from '@trpc/client'
import { MCPServer } from 'mcp-use'
import { oauthBetterAuthProvider } from 'mcp-use/oauth/better-auth'
import superjson from 'superjson'
import { z } from 'zod'

import { parseMcpEnv } from './config'
import { createOpenAiAppsChallengeResponse } from './domain-verification'
import { createExpensePreviewResult } from './expense-preview-response'
import { createReadinessChecker } from './readiness'
import {
  beneficiarySplitSchema,
  createExpenseOutputSchema,
  expenseContextOutputSchema,
  groupSummaryOutputSchema,
  prepareExpenseOutputSchema,
  previewSchema,
  type ExpenseContextOutput,
  type GroupSummaryOutput,
} from './schemas'

const runtimeEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}
const mcpEnv = parseMcpEnv(runtimeEnv)
const { apiUrl, mcpUrl, webUrl } = mcpEnv

// mcp-use v2 reads MCP_URL when generating absolute View asset URLs. Keep the
// app's existing MCP_PUBLIC_URL setting as the single public origin.
process.env.MCP_URL ??= mcpUrl

const scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'spliit:groups:read',
  'spliit:expenses:write',
]

const oauth = oauthBetterAuthProvider({
  authURL: `${apiUrl}/auth`,
  resource: `${mcpUrl}/mcp`,
  scopesSupported: scopes,
})

const server = new MCPServer({
  name: 'spliit-cloud',
  title: 'Spliit Cloud',
  version: '1.0.0',
  description:
    'Create flat or receipt-itemized Spliit expenses from one conversational request with a safe, interactive confirmation preview. Also inspect the connected account’s groups, participants, balances, and recent expenses.',
  instructions: [
    'This server is already scoped to the Spliit account identified by its OAuth bearer token. Treat every returned group, participant, balance, and expense as belonging to that connected account; never use ChatGPT or Claude identity metadata for authorization.',
    'For expense requests, act instead of merely describing a draft. Call get-expense-context when the group ID is not already known. It returns complete group, participant, currency, caller, and category context for one-shot preparation. Match group and participant names case-insensitively. If exactly one stable ID matches the user’s words or context, continue without asking. Ask one short clarification only when genuinely distinct IDs remain plausible, using disambiguationLabel.',
    'Choose the closest valid category from get-expense-context when the description clearly supports one, such as dining-out for restaurant, bar, drinks, or pizza purchases. Otherwise omit category for General. Call get-group-summary only for balances, recent expenses, or deeper group context; participant mapping no longer requires it.',
    'Always pass monetary values as decimal strings. If the user states a currency, pass its uppercase ISO code; otherwise omit currencyCode to use the group currency. Interpret a bare dollar sign as the group currency when its ISO code is a dollar currency (USD, CAD, AUD, NZD, SGD, HKD, or MXN); otherwise use USD. Never invent participant IDs, exchange rates, or category IDs.',
    'For receipt images, read only clearly supported totals, currency, merchant/title, date, category, line items, quantities, and participant assignments from the conversation. Use item shares for quantity statements such as Alex had 2 beers and Alice had 3. Ask one focused clarification if the image or assignments are unreadable, contradictory, or ambiguous; never invent receipt values. Do not send or store the receipt image.',
    'prepare-expense never creates an expense. It returns the required non-editable UI preview. Do not claim the UI is unavailable unless the tool itself returns an error. Do not call create-expense conversationally: only the preview button may commit its sealed payload.',
  ].join(' '),
  basePath: '/mcp',
  port: mcpEnv.port,
  websiteUrl: webUrl,
  favicon: 'favicon.ico',
  icons: [{ src: 'icon.svg', mimeType: 'image/svg+xml', sizes: ['512x512'] }],
  publicLandingPage: false,
  cors: {
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'mcp-protocol-version',
      'mcp-session-id',
      'X-Proxy-Token',
      'X-Target-URL',
    ],
  },
  oauth,
})

server.app.get(
  '/health',
  () =>
    new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    }),
)

const readiness = createReadinessChecker({ apiUrl })
server.app.get('/health/readiness', async () => {
  const result = await readiness.check()
  return new Response(JSON.stringify(result), {
    status: result.status === 'ready' ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
})

server.app.get('/.well-known/openai-apps-challenge', () =>
  createOpenAiAppsChallengeResponse(),
)

if (mcpEnv.nodeEnv === 'production') {
  const hideBrowserSurface = async (
    c: Parameters<Parameters<typeof server.app.use>[1]>[0],
    next: () => Promise<void>,
  ) => {
    const accept = c.req.header('accept') ?? ''
    if (c.req.method === 'GET' && accept.includes('text/html')) {
      return c.body(null, 404)
    }
    await next()
  }

  server.app.use('/mcp', hideBrowserSurface)
  server.app.use('/sse', hideBrowserSurface)
  server.app.get('/inspector', (c) => c.body(null, 404))
  server.app.get('/inspector/*', (c) => c.body(null, 404))
}

// RFC 9728 derives the canonical metadata URL from the `/mcp` resource path.
// Keep the origin-level alias for older hosts that only probe the root URL.
server.app.get('/.well-known/oauth-protected-resource', () =>
  Response.json(
    {
      resource: `${mcpUrl}/mcp`,
      authorization_servers: [`${apiUrl}/auth`],
      scopes_supported: scopes,
      bearer_methods_supported: ['header'],
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  ),
)

type AssistantClient = {
  assistant: {
    listGroups: {
      query: (input?: { groupHint?: string }) => Promise<ExpenseContextOutput>
    }
    getGroupSummary: {
      query: (input: Record<string, unknown>) => Promise<GroupSummaryOutput>
    }
    prepareExpense: {
      mutate: (input: Record<string, unknown>) => Promise<{
        preview: z.infer<typeof previewSchema>
        confirmationToken: string
      }>
    }
    createExpense: {
      mutate: (input: { confirmationToken: string }) => Promise<{
        expenseId: string
        groupId: string
        alreadyCreated: boolean
      }>
    }
  }
}

function apiClient(accessToken: string): AssistantClient {
  // oxlint-disable-next-line typescript/no-explicit-any -- the separately deployed API is narrowed to the facade above at this boundary.
  return createTRPCProxyClient<any>({
    links: [
      httpLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ],
  }) as unknown as AssistantClient
}

function safeError(cause: unknown) {
  if (cause instanceof TRPCClientError) {
    const code =
      cause.data &&
      typeof cause.data === 'object' &&
      'code' in cause.data &&
      typeof cause.data.code === 'string'
        ? cause.data.code
        : undefined
    if (
      code &&
      [
        'BAD_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'PRECONDITION_FAILED',
      ].includes(code)
    ) {
      return cause.message
    }
  }
  return 'Spliit Cloud could not complete this request. Please try again.'
}

function jsonResult<T>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  }
}

function getTimezoneOffsetMinutes(timeZone: string | undefined) {
  if (!timeZone) return undefined
  try {
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts()
      .find(({ type }) => type === 'timeZoneName')?.value
    if (!offset || offset === 'GMT') return 0
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset)
    if (!match) return undefined
    const minutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -minutes : minutes
  } catch {
    return undefined
  }
}

const decimalString = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .describe(
    'A positive decimal string in major currency units, for example 12.50',
  )
const allocation = z.object({
  participantId: z
    .string()
    .describe('Stable participant ID from get-expense-context'),
  amount: decimalString.describe(
    'Exact amount paid by this participant, in the expense currency',
  ),
})
const expenseItem = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('Receipt line-item name as read from the image or user request'),
  unitPrice: decimalString.describe(
    'Price for one unit in the expense currency, excluding quantity',
  ),
  quantity: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe('Positive whole-number quantity shown on the receipt'),
  split: beneficiarySplitSchema
    .optional()
    .describe(
      'Who benefited from this item. Omit for the saved group split, falling back to even across current participants.',
    ),
})

export const getExpenseContext = server.tool(
  {
    name: 'get-expense-context',
    title: 'Get Spliit expense context',
    description:
      "Start here for one-shot expense preparation. Lists only the OAuth-connected Spliit account's active, visible, non-archived groups. Each group includes stable IDs, currency, caller participant ID, every eligible participant with name/status/disambiguation label, and the response includes the complete valid category catalog. Exact duplicate rows are removed. Resolve unique group and participant names here, continue immediately, and ask only when multiple stable IDs remain plausible. Responses are capped; when truncated is true, pass a case-insensitive groupHint (part of the group name) to narrow the list.",
    inputSchema: z.object({
      groupHint: z
        .string()
        .max(120)
        .optional()
        .describe(
          'Case-insensitive part of a group name to narrow a truncated list',
        ),
    }),
    outputSchema: expenseContextOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async (input, ctx) => {
    try {
      const result = await apiClient(
        ctx.auth.accessToken,
      ).assistant.listGroups.query(
        input.groupHint ? { groupHint: input.groupHint } : undefined,
      )
      return jsonResult(expenseContextOutputSchema.parse(result))
    } catch (cause) {
      return toolError(safeError(cause))
    }
  },
)

export const getGroupSummary = server.tool(
  {
    name: 'get-group-summary',
    title: 'Get group summary',
    description:
      "Get one authorized group's saved default split, balances, and recent expenses plus participant context. Use for group insights or deeper context; get-expense-context already provides the participant IDs needed for one-shot expense preparation.",
    inputSchema: z.object({
      groupId: z
        .string()
        .describe('Exact stable group ID returned by get-expense-context'),
      recentExpenseLimit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Number of recent expenses to return, from 1 to 50'),
    }),
    outputSchema: groupSummaryOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async (input, ctx) => {
    try {
      return jsonResult(
        groupSummaryOutputSchema.parse(
          await apiClient(ctx.auth.accessToken).assistant.getGroupSummary.query(
            input,
          ),
        ),
      )
    } catch (cause) {
      return toolError(safeError(cause))
    }
  },
)

export const prepareExpense = server.tool(
  {
    name: 'prepare-expense',
    title: 'Preview a Spliit expense',
    description:
      "Required final step for every conversational expense request. Call it in the same turn as soon as group, amount, and title are known; it validates the authenticated account's access and renders the non-editable confirmation UI. Supports flat splits and receipt-itemized expenses with a different split per item. Omit payer, flat split, item splits, date, category, and currency only when the corresponding Spliit defaults should apply. A different supported ISO currency uses Spliit's date-based exchange rate while preserving entered item and total values.",
    inputSchema: z.object({
      groupId: z
        .string()
        .describe('Exact stable group ID returned by get-expense-context'),
      amount: decimalString.describe(
        'Expense amount in the stated expense currency, e.g. "15" or "15.50"',
      ),
      title: z
        .string()
        .min(2)
        .max(120)
        .describe('Short expense title taken from the user request'),
      date: z.iso
        .date()
        .optional()
        .describe('Expense date as YYYY-MM-DD; omit for caller-local today'),
      category: z
        .string()
        .optional()
        .describe('Spliit category ID; omit for General'),
      notes: z
        .string()
        .max(10_000)
        .optional()
        .describe('Optional private expense notes supplied by the user'),
      currencyCode: z
        .string()
        .min(3)
        .max(4)
        .optional()
        .describe(
          "ISO 4217 or crypto expense currency. Omit for the group's currency; a different supported code is converted using Spliit's authoritative rate.",
        ),
      paidBy: z
        .array(allocation)
        .min(1)
        .optional()
        .describe('Exact payer allocation; omit to use the authenticated user'),
      split: beneficiarySplitSchema.optional(),
      items: z
        .array(expenseItem)
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Clearly readable receipt items. Supplying items creates an ITEMIZED expense and cannot be combined with the flat split field.',
        ),
      remainderSplit: beneficiarySplitSchema
        .optional()
        .describe(
          'How to split tax, tip, or the gap between item subtotals and the expense total. Omit to allocate it proportionally to item subtotals.',
        ),
    }),
    outputSchema: prepareExpenseOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    view: {
      name: 'expense-preview',
      description:
        'A non-editable Spliit expense preview with an explicit confirmation action.',
      prefersBorder: false,
    },
  },
  async (input, ctx) => {
    try {
      const prepared = await apiClient(
        ctx.auth.accessToken,
      ).assistant.prepareExpense.mutate({
        ...input,
        timezoneOffsetMinutes: getTimezoneOffsetMinutes(
          ctx.client.user()?.location?.timezone,
        ),
      })
      return createExpensePreviewResult({
        preview: previewSchema.parse(prepared.preview),
        confirmationToken: prepared.confirmationToken,
        webUrl,
      })
    } catch (cause) {
      return toolError(safeError(cause))
    }
  },
)

export const createExpense = server.tool(
  {
    name: 'create-expense',
    title: 'Confirm previewed expense',
    description:
      'View-only confirmation. Commits exactly the encrypted expense preview; accepts no editable expense fields.',
    inputSchema: z.object({ confirmationToken: z.string() }),
    outputSchema: createExpenseOutputSchema,
    visibility: 'app',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  async (input, ctx) => {
    try {
      const result = await apiClient(
        ctx.auth.accessToken,
      ).assistant.createExpense.mutate(input)
      return jsonResult(
        createExpenseOutputSchema.parse({
          ...result,
          expenseUrl: `${webUrl}/groups/${result.groupId}/expenses/${result.expenseId}`,
        }),
      )
    } catch (cause) {
      return toolError(safeError(cause))
    }
  },
)

export const addSpliitExpense = server.prompt(
  {
    name: 'add-spliit-expense',
    description:
      'Guide the assistant through the lowest-friction safe workflow for creating a Spliit expense with an interactive confirmation preview.',
    schema: z.object({
      request: z
        .string()
        .describe(
          'The user’s natural-language expense request, including any known group, amount, currency, payer, or split',
        ),
    }),
  },
  async ({ request }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Fulfil this Spliit expense request: ${request}`,
            'Resolve the group with get-expense-context. Results are already restricted to the OAuth-connected Spliit account.',
            'Resolve unique group and participant names case-insensitively from that one response. Ask one concise clarification only for multiple distinct matching IDs.',
            'Choose the closest valid category when the title clearly supports one; otherwise use General. Treat bare $ as the group currency for dollar-currency groups and USD otherwise.',
            'If the request contains a receipt image, extract only clearly readable total, currency, merchant/title, date, category, items, quantities, and assignments. Ask one focused question for unreadable or contradictory values. Do not pass or store the image.',
            'Then call prepare-expense in the same turn; do not stop at a prose draft. Omit unspecified payer, split, date, category, and currency only where Spliit should apply its defaults.',
            'The returned card is the only confirmation surface. Never call create-expense yourself.',
          ].join('\n'),
        },
      },
    ],
  }),
)

export default server
