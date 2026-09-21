import { z } from 'zod'

import {
  DEFAULT_MAX_EXPENSE_DOCUMENT_SIZE_MB,
  supportedCurrencyCodeSchema,
} from '@spliit/domain'

const interpretEnvVarAsBool = (val: unknown): boolean => {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}

// Variant that preserves `undefined` so a `z.boolean().default(true)` schema
// keeps its default when the variable is unset, while still parsing
// explicit "false"/"0"/"off" as false. Empty strings count as unset:
// compose interpolation (`${VAR:-}`) and env files often produce those, and
// flipping a default-true flag off on empty would be surprising.
const interpretOptionalEnvVarAsBool = (val: unknown): boolean | undefined => {
  if (val === undefined) return undefined
  if (typeof val === 'string' && val.trim() === '') return undefined
  return interpretEnvVarAsBool(val)
}

const emptyStringAsUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val

/**
 * Strip terminal trailing slashes from a URL env value (`https://host/` →
 * `https://host`). Terminal-only stripping mirrors the web client's
 * `VITE_API_URL` handling (`api-url.ts`) and is safe for path-bearing URLs
 * (`https://api.example.com/v1/` → `.../v1`): every concatenation site in the
 * API adds its own leading slash, so a stored trailing slash always produces
 * `//` (invite links, unsubscribe, OAuth pages, `/mcp` audiences, …).
 *
 * Warns so operators notice the non-canonical value; parsing continues with the
 * stripped form instead of failing boot for existing deployments (see issue
 * #120: `APP_URL=https://host/` flowed into `WEB_ORIGINS` / `BETTER_AUTH_URL`
 * and broke invite links + CORS/trusted-origins).
 */
function stripTrailingSlashesWithWarn(raw: unknown, field: string): unknown {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (trimmed === '') return raw
  const stripped = trimmed.replace(/\/+$/, '')
  if (stripped !== trimmed) {
    console.warn(
      `[env] ${field} had trailing slash(es) which were stripped (got "${trimmed}", using "${stripped}"). Use the canonical form with no trailing slash.`,
    )
  }
  return stripped === '' ? undefined : stripped
}

const normalizeUrlValue =
  (field: string) =>
  (val: unknown): unknown =>
    emptyStringAsUndefined(stripTrailingSlashesWithWarn(val, field))

const optionalUrlNormalized = (field: string) =>
  z.preprocess(normalizeUrlValue(field), z.url().optional())

const optionalStringNormalized = (field: string) =>
  z.preprocess(normalizeUrlValue(field), z.string().optional())

/**
 * Normalize `WEB_ORIGINS` (comma-separated origins): trim each entry, strip
 * terminal slashes, drop empties, rejoin. Warns per stripped entry. Returns
 * `undefined` for empty input so the `localhost:3000` default applies.
 */
function normalizeWebOrigins(val: unknown): unknown {
  const emptied = emptyStringAsUndefined(val)
  if (typeof emptied !== 'string') return emptied
  const normalized = emptied
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const stripped = part.replace(/\/+$/, '')
      if (stripped !== part) {
        console.warn(
          `[env] WEB_ORIGINS entry had trailing slash(es) which were stripped (got "${part}", using "${stripped}"). Use the canonical form with no trailing slash.`,
        )
      }
      return stripped
    })
    .filter(Boolean)
  if (normalized.length === 0) return undefined
  return normalized.join(',')
}

const optionalString = z.preprocess(
  emptyStringAsUndefined,
  z.string().optional(),
)

const envSchema = z
  .object({
    NODE_ENV: optionalString,
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGINS: z.preprocess(
      normalizeWebOrigins,
      z.string().default('http://localhost:3000'),
    ),
    DATABASE_URL: optionalUrlNormalized('DATABASE_URL'),
    PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_DEFAULT_CURRENCY_CODE: supportedCurrencyCodeSchema.default('USD'),
    S3_UPLOAD_KEY: optionalString,
    S3_UPLOAD_SECRET: optionalString,
    S3_UPLOAD_BUCKET: optionalString,
    S3_UPLOAD_REGION: optionalString,
    S3_UPLOAD_ENDPOINT: optionalStringNormalized('S3_UPLOAD_ENDPOINT'),
    S3_UPLOAD_PUBLIC_URL: optionalUrlNormalized('S3_UPLOAD_PUBLIC_URL'),
    // Maximum expense/receipt attachment size in megabytes. Defaults to 2 to
    // preserve historical behavior; uploads go directly to S3 via presigned
    // URLs so this does not affect the API request body limit, but larger
    // values increase memory use during export/sha256 verification. Capped at
    // 50 to match the staged import-token ceiling in `lib/import-documents.ts`
    // (static zod schemas cannot read per-request env, so the ceiling is the
    // highest value the import flows can seal).
    MAX_EXPENSE_DOCUMENT_SIZE_MB: z.preprocess(
      emptyStringAsUndefined,
      z.coerce
        .number()
        .finite()
        .min(0.01)
        .max(50)
        .default(DEFAULT_MAX_EXPENSE_DOCUMENT_SIZE_MB),
    ),
    PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_VOICE_EXPENSE: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    PUBLIC_ENABLE_BULK_CATEGORIZE: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    AI_PROVIDER: z
      .enum(['openai', 'anthropic', 'openai-compatible', 'google'])
      .default('openai'),
    AI_API_KEY: optionalString,
    AI_BASE_URL: optionalUrlNormalized('AI_BASE_URL'),
    AI_RECEIPT_MODEL: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('gpt-5-nano'),
    ),
    AI_CATEGORY_MODEL: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('gpt-5-nano'),
    ),
    AI_VOICE_MODEL: z.preprocess(emptyStringAsUndefined, z.string().optional()),
    AI_RECEIPT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
    AI_VOICE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
    AI_CATEGORY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
    AI_CATEGORY_RECENT_EXPENSES_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(50),
    /**
     * Which AI backend classifies a single expense title when the local stages
     * miss: the configured LLM provider, or a System One decision model
     * (TypeSafe's Jev by default; any `/v1/systemone`-compatible model such as
     * a self-hosted Kev via AI_SYSTEM_ONE_BASE_URL). Exactly one engine runs
     * per suggestion.
     */
    AI_CATEGORY_ENGINE: z.enum(['llm', 'system-one']).default('llm'),
    /**
     * API key for the System One decision-model endpoint. Only used when
     * AI_CATEGORY_ENGINE is 'system-one'. Keep this server-side; never expose
     * to the web client.
     */
    AI_SYSTEM_ONE_API_KEY: optionalString,
    AI_SYSTEM_ONE_MODEL: z.preprocess(
      emptyStringAsUndefined,
      z.string().default('jev-latest'),
    ),
    AI_SYSTEM_ONE_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    AI_SYSTEM_ONE_BASE_URL: z.preprocess(
      emptyStringAsUndefined,
      z.url().default('https://api.typesafe.ai/v1/systemone'),
    ),
    /**
     * Minimum AI confidence (0–1) for a suggestion to be applied, whichever
     * engine runs: the decision model reports model confidence, the LLM
     * self-reports confidence in its structured verdict. Below the floor the
     * verdict degrades to no suggestion. Defaults to 0.5 as a conservative
     * starting point — calibrate on a labeled sample of real expenses before
     * changing. Note the two confidences are not on the same scale (LLM
     * self-reports skew high), so recalibrate when switching engines.
     */
    AI_CATEGORY_MIN_CONFIDENCE: z.preprocess(
      emptyStringAsUndefined,
      z.coerce.number().min(0).max(1).default(0.5),
    ),
    /**
     * Master switches for the local single-expense suggest stages. Both default
     * to on; the web client mirrors them (via `features.get`) because it runs
     * the same local matching before calling the server.
     */
    CATEGORY_DICTIONARY_ENABLED: z.preprocess(
      interpretOptionalEnvVarAsBool,
      z.boolean().default(true),
    ),
    CATEGORY_HISTORY_ENABLED: z.preprocess(
      interpretOptionalEnvVarAsBool,
      z.boolean().default(true),
    ),
    /**
     * Local-matcher gates for the suggest flow (dictionary + history, client
     * and server run the same matcher). Defaults preserve the long-standing
     * behavior; tuned values apply to suggestions only — expense-list query
     * expansion stays on the domain constants.
     */
    CATEGORY_LOCAL_MIN_SCORE: z.preprocess(
      emptyStringAsUndefined,
      z.coerce.number().min(0).max(1).default(0.8),
    ),
    CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE: z.preprocess(
      emptyStringAsUndefined,
      z.coerce.number().min(0).max(1).default(0.95),
    ),
    /** Recent title→category pairs for local matching (not sent to the LLM). */
    CATEGORY_MEMORY_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .max(2000)
      .default(200),

    // better-auth
    BETTER_AUTH_SECRET: optionalString,
    BETTER_AUTH_URL: optionalUrlNormalized('BETTER_AUTH_URL'),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    TWITTER_CLIENT_ID: optionalString,
    TWITTER_CLIENT_SECRET: optionalString,
    OIDC_CLIENT_ID: optionalString,
    OIDC_CLIENT_SECRET: optionalString,
    OIDC_DISCOVERY_URL: optionalUrlNormalized('OIDC_DISCOVERY_URL'),
    OIDC_DISPLAY_NAME: optionalString,
    OIDC_PROVIDER_ID: z.preprocess(
      emptyStringAsUndefined,
      z
        .string()
        .regex(
          /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
          'OIDC_PROVIDER_ID must be a URL-safe identifier',
        )
        .optional(),
    ),
    ENABLE_ANONYMOUS_AUTH: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    // Email sign-in (password + magic link). Defaults to true to preserve
    // historical behavior. Set to false for SSO-only instances (OIDC/social);
    // SMTP then becomes optional (see superRefine below).
    ENABLE_EMAIL_AUTH: z.preprocess(
      interpretOptionalEnvVarAsBool,
      z.boolean().default(true),
    ),
    ENABLE_MCP: z.preprocess(interpretEnvVarAsBool, z.boolean().default(false)),
    MCP_PUBLIC_URL: optionalUrlNormalized('MCP_PUBLIC_URL'),
    ASSISTANT_CONFIRMATION_SECRET: optionalString,
    // Set when the API sits behind a trusted reverse proxy (Dokploy, Caddy,
    // a CDN). Only then are X-Forwarded-For / X-Real-IP honored for rate-limit
    // identity; the edge proxy must ensure the right-most forwarded hop is the
    // client address it observed.
    TRUST_PROXY: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),

    // Email delivery (magic link + verification)
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      emptyStringAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    EMAIL_FROM: optionalString,

    // Web Push delivery. These are intentionally optional outside production
    // so local development can run without a VAPID key pair.
    PUSH_VAPID_PUBLIC_KEY: optionalString,
    PUSH_VAPID_PRIVATE_KEY: optionalString,
    PUSH_VAPID_SUBJECT: optionalUrlNormalized('PUSH_VAPID_SUBJECT'),

    // Dedicated secret for stateless optional-email unsubscribe links.
    EMAIL_UNSUBSCRIBE_SECRET: optionalString,

    // Outbound webhook destinations are public HTTPS by default. Self-hosted
    // instances may opt into LAN/HTTP targets explicitly.
    WEBHOOK_ALLOW_PRIVATE_ENDPOINTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),

    // Optional Cloudflare Worker relay that forwards webhook deliveries so
    // destinations never see the server IP. Both values are required together.
    // A configured relay cannot reach private networks (see superRefine).
    WEBHOOK_RELAY_URL: optionalStringNormalized('WEBHOOK_RELAY_URL'),
    WEBHOOK_RELAY_SECRET: optionalString,

    // Account registration. `open` is the historical default (anyone can
    // create an account). `invite_only` restricts sign-up to the first
    // account on a fresh instance, emails with a pending group/friend
    // invitation, or visitors carrying a live share-link invite token.
    SIGNUP_MODE: z.enum(['open', 'invite_only']).default('open'),

    // Android TWA (Trusted Web Activity) identity for
    // `/.well-known/assetlinks.json`. Both empty means no TWA is configured
    // and the route 404s. Fingerprints are comma-separated SHA-256 cert
    // fingerprints (colon-separated keytool output is accepted); keep the
    // upload-key and Play App-signing fingerprints listed together.
    TWA_PACKAGE_NAME: optionalString,
    TWA_SHA256_FINGERPRINTS: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET is required in production',
      })
    }
    if (env.ENABLE_ANONYMOUS_AUTH && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message:
          'BETTER_AUTH_SECRET is required when ENABLE_ANONYMOUS_AUTH is true',
      })
    }
    if (env.ENABLE_ANONYMOUS_AUTH && !env.TRUST_PROXY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'TRUST_PROXY is required when ENABLE_ANONYMOUS_AUTH is true',
      })
    }
    if (env.ENABLE_MCP && !env.MCP_PUBLIC_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_PUBLIC_URL'],
        message: 'MCP_PUBLIC_URL is required when ENABLE_MCP is true',
      })
    }
    if (
      env.ENABLE_MCP &&
      (!env.ASSISTANT_CONFIRMATION_SECRET ||
        Buffer.byteLength(env.ASSISTANT_CONFIRMATION_SECRET, 'utf8') < 32)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ASSISTANT_CONFIRMATION_SECRET'],
        message:
          'ASSISTANT_CONFIRMATION_SECRET must be at least 32 bytes when ENABLE_MCP is true',
      })
    }
    // SMTP is required in production only while email auth is enabled.
    // SSO-only instances (ENABLE_EMAIL_AUTH=false) may run without SMTP;
    // email invitations then skip delivery and rely on the in-app pending
    // list (see email-invitations.ts), and link invites work fully offline.
    if (
      env.NODE_ENV === 'production' &&
      env.ENABLE_EMAIL_AUTH &&
      !env.SMTP_HOST
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'SMTP_HOST is required in production when ENABLE_EMAIL_AUTH is true (set ENABLE_EMAIL_AUTH=false for SSO-only instances without SMTP)',
      })
    }
    if (
      env.NODE_ENV === 'production' &&
      env.ENABLE_EMAIL_AUTH &&
      !env.EMAIL_FROM
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message:
          'EMAIL_FROM is required in production when ENABLE_EMAIL_AUTH is true',
      })
    }
    // Disabling email auth without any SSO/social provider locks every user
    // out (existing email accounts are rejected too). Fail boot early with a
    // clear message instead of serving an empty login panel.
    if (!env.ENABLE_EMAIL_AUTH) {
      const hasOidc = !!(
        env.OIDC_CLIENT_ID &&
        env.OIDC_CLIENT_SECRET &&
        env.OIDC_DISCOVERY_URL
      )
      const hasSocial = !!(
        (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) ||
        (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) ||
        (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET)
      )
      if (!hasOidc && !hasSocial) {
        ctx.addIssue({
          code: 'custom',
          path: ['ENABLE_EMAIL_AUTH'],
          message:
            'ENABLE_EMAIL_AUTH=false requires at least one SSO provider (OIDC_CLIENT_ID/SECRET/DISCOVERY_URL or Google/GitHub/Twitter credentials)',
        })
      }
    }
    const pushVapidValues = [
      env.PUSH_VAPID_PUBLIC_KEY,
      env.PUSH_VAPID_PRIVATE_KEY,
      env.PUSH_VAPID_SUBJECT,
    ]
    if (pushVapidValues.some(Boolean) && !pushVapidValues.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_VAPID_PUBLIC_KEY'],
        message:
          'PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and PUSH_VAPID_SUBJECT must be configured together',
      })
    }
    // Authenticated SMTP requires both values; omitting both intentionally
    // supports trusted self-hosted relays that do not require credentials.
    if (!!env.SMTP_USER !== !!env.SMTP_PASS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP_USER and SMTP_PASS must be configured together',
      })
    }
    // The webhook relay is deployment configuration: both values together or
    // neither. A relayed delivery cannot reach private networks, so combining
    // a production (HTTPS) relay with private endpoints is a boot error. An
    // HTTP relay URL is only accepted for local `wrangler dev` testing, which
    // already requires the private-endpoints escape hatch.
    if (!!env.WEBHOOK_RELAY_URL !== !!env.WEBHOOK_RELAY_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_RELAY_URL'],
        message:
          'WEBHOOK_RELAY_URL and WEBHOOK_RELAY_SECRET must be configured together',
      })
    }
    if (
      env.WEBHOOK_RELAY_URL &&
      env.WEBHOOK_RELAY_SECRET &&
      Buffer.byteLength(env.WEBHOOK_RELAY_SECRET, 'utf8') < 32
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_RELAY_SECRET'],
        message: 'WEBHOOK_RELAY_SECRET must be at least 32 bytes',
      })
    }
    if (env.WEBHOOK_RELAY_URL) {
      let relayProtocol: string | undefined
      try {
        relayProtocol = new URL(env.WEBHOOK_RELAY_URL).protocol
      } catch {
        relayProtocol = undefined
      }
      if (
        relayProtocol !== 'https:' &&
        !(relayProtocol === 'http:' && env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_RELAY_URL'],
          message:
            'WEBHOOK_RELAY_URL must be an HTTPS URL (HTTP is only allowed for local development when WEBHOOK_ALLOW_PRIVATE_ENDPOINTS is true)',
        })
      } else if (
        relayProtocol === 'https:' &&
        env.WEBHOOK_ALLOW_PRIVATE_ENDPOINTS
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_ALLOW_PRIVATE_ENDPOINTS'],
          message:
            'WEBHOOK_ALLOW_PRIVATE_ENDPOINTS must be false when WEBHOOK_RELAY_URL is configured; the relay cannot reach private-network destinations',
        })
      }
    }
    if (env.NODE_ENV === 'production' && env.SMTP_HOST) {
      if (
        !env.EMAIL_UNSUBSCRIBE_SECRET ||
        Buffer.byteLength(env.EMAIL_UNSUBSCRIBE_SECRET, 'utf8') < 32
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_UNSUBSCRIBE_SECRET'],
          message:
            'EMAIL_UNSUBSCRIBE_SECRET must be at least 32 bytes in production',
        })
      }
    }
    if (
      env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS &&
      (!env.S3_UPLOAD_BUCKET ||
        !env.S3_UPLOAD_KEY ||
        !env.S3_UPLOAD_REGION ||
        !env.S3_UPLOAD_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'If PUBLIC_ENABLE_EXPENSE_DOCUMENTS is specified, then S3_* must be specified too',
      })
    }
    if (
      (env.PUBLIC_ENABLE_RECEIPT_EXTRACT ||
        env.PUBLIC_ENABLE_VOICE_EXPENSE ||
        (env.PUBLIC_ENABLE_CATEGORY_EXTRACT &&
          env.AI_CATEGORY_ENGINE === 'llm')) &&
      !env.AI_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'If PUBLIC_ENABLE_RECEIPT_EXTRACT, PUBLIC_ENABLE_VOICE_EXPENSE, or PUBLIC_ENABLE_CATEGORY_EXTRACT with AI_CATEGORY_ENGINE=llm is specified, then AI_API_KEY must be specified too',
      })
    }
    if (
      env.PUBLIC_ENABLE_CATEGORY_EXTRACT &&
      env.AI_CATEGORY_ENGINE === 'system-one' &&
      !env.AI_SYSTEM_ONE_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_SYSTEM_ONE_API_KEY'],
        message:
          'AI_SYSTEM_ONE_API_KEY must be specified when PUBLIC_ENABLE_CATEGORY_EXTRACT is enabled with AI_CATEGORY_ENGINE=system-one',
      })
    }
    if (env.PUBLIC_ENABLE_VOICE_EXPENSE && !env.AI_VOICE_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_VOICE_MODEL'],
        message:
          'AI_VOICE_MODEL must be specified when PUBLIC_ENABLE_VOICE_EXPENSE is enabled',
      })
    }
    const oidcValues = [
      env.OIDC_CLIENT_ID,
      env.OIDC_CLIENT_SECRET,
      env.OIDC_DISCOVERY_URL,
      env.OIDC_DISPLAY_NAME,
      env.OIDC_PROVIDER_ID,
    ]
    if (
      oidcValues.some(Boolean) &&
      (!env.OIDC_CLIENT_ID ||
        !env.OIDC_CLIENT_SECRET ||
        !env.OIDC_DISCOVERY_URL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_CLIENT_ID'],
        message:
          'OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_DISCOVERY_URL must be configured together',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

/**
 * Parse a raw environment mapping into the validated {@link Env} shape. Defaults
 * to `process.env`; tests pass isolated literal objects so schema cases stay
 * independent of ambient environment files.
 */
export function parseEnv(rawEnv: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(rawEnv)
}

export const env = parseEnv()
// Defense in depth: `env.WEB_ORIGINS` is already normalized by the schema,
// but tests and direct `env` mutation bypass `parseEnv`, so strip again here
// so CORS / `trustedOrigins` / `${webOrigins[0]}/…` builders never see `//`.
export const webOrigins = env.WEB_ORIGINS.split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)
export const hasDatabaseEnv = !!env.DATABASE_URL

/**
 * Expense attachment limit in bytes, derived from
 * `MAX_EXPENSE_DOCUMENT_SIZE_MB`. Rounded so fractional megabytes (e.g. 0.5)
 * behave predictably. Accepts an explicit source so tests can pass isolated env
 * objects without mutating the global `env`.
 */
export function getMaxExpenseDocumentSizeBytes(
  source: { MAX_EXPENSE_DOCUMENT_SIZE_MB?: number } = env,
): number {
  const megabytes =
    source.MAX_EXPENSE_DOCUMENT_SIZE_MB ?? DEFAULT_MAX_EXPENSE_DOCUMENT_SIZE_MB
  return Math.round(megabytes * 1024 * 1024)
}

export const DEFAULT_OIDC_PROVIDER_ID = 'oidc'
export const DEFAULT_OIDC_DISPLAY_NAME = 'SSO'

export type WebhookRelayConfig = {
  url: string
  secret: string
}

/**
 * Relay configuration for outbound webhook deliveries. Returns `undefined` when
 * the relay is not configured (direct delivery). Accepts an explicit source so
 * tests can pass isolated env objects without mutating global env.
 */
export function getWebhookRelayConfig(
  source: {
    WEBHOOK_RELAY_URL?: string
    WEBHOOK_RELAY_SECRET?: string
  } = env,
): WebhookRelayConfig | undefined {
  if (!source.WEBHOOK_RELAY_URL || !source.WEBHOOK_RELAY_SECRET) {
    return undefined
  }
  return { url: source.WEBHOOK_RELAY_URL, secret: source.WEBHOOK_RELAY_SECRET }
}
export type ConfiguredOidcProvider = {
  id: string
  name: string
  clientId: string
  clientSecret: string
  discoveryUrl: string
}

export function getConfiguredOidcProvider(
  source: {
    OIDC_CLIENT_ID?: string
    OIDC_CLIENT_SECRET?: string
    OIDC_DISCOVERY_URL?: string
    OIDC_DISPLAY_NAME?: string
    OIDC_PROVIDER_ID?: string
  } = env,
): ConfiguredOidcProvider | undefined {
  if (
    !source.OIDC_CLIENT_ID ||
    !source.OIDC_CLIENT_SECRET ||
    !source.OIDC_DISCOVERY_URL
  ) {
    return undefined
  }
  return {
    id: source.OIDC_PROVIDER_ID ?? DEFAULT_OIDC_PROVIDER_ID,
    name: source.OIDC_DISPLAY_NAME ?? DEFAULT_OIDC_DISPLAY_NAME,
    clientId: source.OIDC_CLIENT_ID,
    clientSecret: source.OIDC_CLIENT_SECRET,
    discoveryUrl: source.OIDC_DISCOVERY_URL,
  }
}

/**
 * Whether email sign-in (password + magic link) is enabled. Defaults to true
 * when unset to preserve historical behavior. Accepts an explicit source so
 * tests can pass isolated env objects without mutating global env.
 */
export function isEmailAuthEnabled(
  source: { ENABLE_EMAIL_AUTH?: boolean } = env,
): boolean {
  return source.ENABLE_EMAIL_AUTH ?? true
}

/**
 * Whether outbound email can be delivered. Requires both the transport
 * (`SMTP_HOST`) and a sender identity (`EMAIL_FROM`): a host without a from
 * address cannot produce sendable mail, so it counts as undeliverable rather
 * than silently misconfigured. Drives the web delivery hint and the quiet skip
 * for best-effort sends on instances that run without SMTP. Accepts an explicit
 * source so tests can pass isolated env objects without mutating global env.
 */
export function isEmailDeliveryEnabled(
  source: { SMTP_HOST?: string; EMAIL_FROM?: string } = env,
): boolean {
  return !!source.SMTP_HOST && !!source.EMAIL_FROM
}
