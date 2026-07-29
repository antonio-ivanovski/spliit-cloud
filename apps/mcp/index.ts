import { createTRPCProxyClient, httpLink, TRPCClientError } from '@trpc/client'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import {
  MCPServer,
  error,
  object,
  oauthBetterAuthProvider,
  text,
} from 'mcp-use/server'
import superjson from 'superjson'
import { z } from 'zod'

import { parseMcpEnv } from './config'
import { createOpenAiAppsChallengeResponse } from './domain-verification'
import { createExpensePreviewResult } from './expense-preview-response'
import { createReadinessChecker } from './readiness'
import {
  createExpenseOutputSchema,
  expenseContextOutputSchema,
  groupSummaryOutputSchema,
  prepareExpenseOutputSchema,
  previewSchema,
  type ExpenseContextOutput,
  type GroupSummaryOutput,
} from './schemas'
import { configureBuiltWidgetDomain } from './widget-manifest'

const runtimeEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}
const mcpEnv = parseMcpEnv(runtimeEnv)
const { apiUrl, mcpUrl, webUrl } = mcpEnv
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
  verifyJwt: true,
  scopesSupported: scopes,
  getUserInfo: (payload) => ({
    userId:
      typeof payload.sub === 'string' ? payload.sub : 'unknown-spliit-user',
  }),
})
const oauthJwks = createRemoteJWKSet(new URL('/auth/jwks', apiUrl))
oauth.verifyToken = async (token) =>
  jwtVerify(token, oauthJwks, {
    issuer: `${apiUrl}/auth`,
    audience: `${mcpUrl}/mcp`,
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
  baseUrl: mcpUrl,
  websiteUrl: webUrl,
  favicon: 'favicon.ico',
  icons: [{ src: 'icon.svg', mimeType: 'image/svg+xml', sizes: ['512x512'] }],
  publicLandingPage: false,
  cors: {
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'mcp-protocol-version',
      'mcp-session-id',
      'X-Proxy-Token',
      'X-Target-URL',
    ],
    exposeHeaders: ['mcp-session-id', 'WWW-Authenticate'],
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

// mcp-use's root protected-resource route currently advertises only the
// service origin. OAuth clients treat that value as the canonical MCP
// resource and retry initialization at `/`, so keep it aligned with the
// actual streamable HTTP endpoint and token audience.
server.app.get('/.well-known/oauth-protected-resource', () => {
  return new Response(
    JSON.stringify({
      resource: `${mcpUrl}/mcp`,
      authorization_servers: [`${apiUrl}/auth`],
      scopes_supported: scopes,
      bearer_methods_supported: ['header'],
    }),
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'content-type': 'application/json; charset=UTF-8',
      },
    },
  )
})

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
const beneficiarySplit = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EVENLY').describe('Split equally'),
    participantIds: z
      .array(
        z.string().describe('Stable participant ID from get-expense-context'),
      )
      .min(1)
      .optional()
      .describe('Omit to split among all current participants'),
  }),
  z.object({
    mode: z.literal('BY_SHARES').describe('Split by relative whole shares'),
    shares: z
      .array(
        z.object({
          participantId: z
            .string()
            .describe('Stable participant ID from get-expense-context'),
          shares: z
            .number()
            .int()
            .positive()
            .describe('Positive whole-number share weight'),
        }),
      )
      .min(1)
      .describe('Participant share weights'),
  }),
  z.object({
    mode: z
      .literal('BY_PERCENTAGE')
      .describe('Split by human percentages totaling 100'),
    shares: z
      .array(
        z.object({
          participantId: z
            .string()
            .describe('Stable participant ID from get-expense-context'),
          percentage: decimalString.describe(
            'Human percentage, e.g. 25 or 33.33; values must total 100',
          ),
        }),
      )
      .min(1)
      .describe('Participant percentage allocations'),
  }),
  z.object({
    mode: z
      .literal('BY_AMOUNT')
      .describe('Split by exact expense-currency amounts'),
    shares: z
      .array(allocation)
      .min(1)
      .describe('Participant exact-amount allocations'),
  }),
])
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
  split: beneficiarySplit
    .optional()
    .describe(
      'Who benefited from this item. Omit for the saved group split, falling back to even across current participants.',
    ),
})

server.tool(
  {
    name: 'get-expense-context',
    title: 'Get Spliit expense context',
    description:
      "Start here for one-shot expense preparation. Lists only the OAuth-connected Spliit account's active, visible, non-archived groups. Each group includes stable IDs, currency, caller participant ID, every eligible participant with name/status/disambiguation label, and the response includes the complete valid category catalog. Exact duplicate rows are removed. Resolve unique group and participant names here, continue immediately, and ask only when multiple stable IDs remain plausible. Responses are capped; when truncated is true, pass a case-insensitive groupHint (part of the group name) to narrow the list.",
    schema: z.object({
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
      return object(expenseContextOutputSchema.parse(result))
    } catch (cause) {
      return error(safeError(cause))
    }
  },
)

server.tool(
  {
    name: 'get-group-summary',
    title: 'Get group summary',
    description:
      "Get one authorized group's saved default split, balances, and recent expenses plus participant context. Use for group insights or deeper context; get-expense-context already provides the participant IDs needed for one-shot expense preparation.",
    schema: z.object({
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
      return object(
        groupSummaryOutputSchema.parse(
          await apiClient(ctx.auth.accessToken).assistant.getGroupSummary.query(
            input,
          ),
        ),
      )
    } catch (cause) {
      return error(safeError(cause))
    }
  },
)

server.tool(
  {
    name: 'prepare-expense',
    title: 'Preview a Spliit expense',
    description:
      "Required final step for every conversational expense request. Call it in the same turn as soon as group, amount, and title are known; it validates the authenticated account's access and renders the non-editable confirmation UI. Supports flat splits and receipt-itemized expenses with a different split per item. Omit payer, flat split, item splits, date, category, and currency only when the corresponding Spliit defaults should apply. A different supported ISO currency uses Spliit's date-based exchange rate while preserving entered item and total values.",
    schema: z.object({
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
        .length(3)
        .optional()
        .describe(
          "ISO 4217 expense currency. Omit for the group's currency; a different supported code is converted using Spliit's authoritative rate.",
        ),
      paidBy: z
        .array(allocation)
        .min(1)
        .optional()
        .describe('Exact payer allocation; omit to use the authenticated user'),
      split: beneficiarySplit.optional(),
      items: z
        .array(expenseItem)
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Clearly readable receipt items. Supplying items creates an ITEMIZED expense and cannot be combined with the flat split field.',
        ),
      remainderSplit: beneficiarySplit
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
    widget: {
      name: 'expense-preview',
      invoking: 'Preparing expense preview…',
      invoked: 'Expense ready to review',
      widgetAccessible: true,
      resultCanProduceWidget: true,
    },
  },
  async (input, ctx) => {
    try {
      const prepared = await apiClient(
        ctx.auth.accessToken,
      ).assistant.prepareExpense.mutate({
        ...input,
        timezoneOffsetMinutes: ctx.client.user()?.timezoneOffsetMinutes,
      })
      return createExpensePreviewResult({
        preview: previewSchema.parse(prepared.preview),
        confirmationToken: prepared.confirmationToken,
        webUrl,
      })
    } catch (cause) {
      return error(safeError(cause))
    }
  },
)

server.tool(
  {
    name: 'create-expense',
    title: 'Confirm previewed expense',
    description:
      'Widget-only confirmation. Commits exactly the encrypted expense preview; accepts no editable expense fields.',
    schema: z.object({ confirmationToken: z.string() }),
    outputSchema: createExpenseOutputSchema,
    _meta: {
      ui: { visibility: ['app'] },
      'openai/visibility': 'private',
      'openai/widgetAccessible': true,
    },
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
      return object(
        createExpenseOutputSchema.parse({
          ...result,
          expenseUrl: `${webUrl}/groups/${result.groupId}/expenses/${result.expenseId}`,
        }),
      )
    } catch (cause) {
      return error(safeError(cause))
    }
  },
)

server.prompt(
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
  async ({ request }) =>
    text(
      [
        `Fulfil this Spliit expense request: ${request}`,
        'Resolve the group with get-expense-context. Results are already restricted to the OAuth-connected Spliit account.',
        'Resolve unique group and participant names case-insensitively from that one response. Ask one concise clarification only for multiple distinct matching IDs.',
        'Choose the closest valid category when the title clearly supports one; otherwise use General. Treat bare $ as the group currency for dollar-currency groups and USD otherwise.',
        'If the request contains a receipt image, extract only clearly readable total, currency, merchant/title, date, category, items, quantities, and assignments. Ask one focused question for unreadable or contradictory values. Do not pass or store the image.',
        'Then call prepare-expense in the same turn; do not stop at a prose draft. Omit unspecified payer, split, date, category, and currency only where Spliit should apply its defaults.',
        'The returned card is the only confirmation surface. Never call create-expense yourself.',
      ].join('\n'),
    ),
)

if (mcpEnv.nodeEnv === 'production') {
  configureBuiltWidgetDomain(new URL('./mcp-use.json', import.meta.url), mcpUrl)
}

void server.listen(mcpEnv.port).then(() => {
  console.log('Spliit Assistant MCP server is running')
})
