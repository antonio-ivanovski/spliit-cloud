import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

config({ path: new URL('../../.env', import.meta.url) })

let datasourceUrl: string

try {
  datasourceUrl = env('DATABASE_URL')
} catch (error) {
  console.warn(
    `DATABASE_URL environment variable is not set. Using dummy value for datasource URL.`,
    error,
  )
  datasourceUrl = 'postgresql://spliit:spliit@localhost:5432/spliit'
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: datasourceUrl,
  },
})
