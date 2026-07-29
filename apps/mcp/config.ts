import { z } from 'zod'

const serviceUrl = z.url({ protocol: /^https?$/ })
const serviceOrigin = serviceUrl.refine(
  (value) => {
    const url = new URL(value)
    return url.pathname === '/' && !url.search && !url.hash
  },
  {
    message: 'MCP_PUBLIC_URL must be an origin without a path, query, or hash',
  },
)

const mcpEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3002),
  MCP_PUBLIC_URL: serviceOrigin,
  MCP_API_URL: serviceUrl,
  MCP_WEB_URL: serviceUrl,
})

export function parseMcpEnv(source: Record<string, string | undefined>) {
  const parsed = mcpEnvSchema.parse(source)

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    apiUrl: stripTrailingSlash(parsed.MCP_API_URL),
    mcpUrl: stripTrailingSlash(parsed.MCP_PUBLIC_URL),
    webUrl: stripTrailingSlash(parsed.MCP_WEB_URL),
  }
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, '')
}
