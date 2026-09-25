import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  )
}

describe('notification architecture boundaries', () => {
  it('server.ts does not import legacy dispatcher initialization', () => {
    const source = readFileSync(resolve(__dirname, '../../server.ts'), 'utf-8')
    expect(source).not.toContain('initializeDefaultNotificationDispatchers')
    expect(importSpecifiers(source)).not.toContain(
      '../lib/notifications/dispatcher',
    )
  })

  it('delivery-repository does not import provider-level senders', () => {
    const source = readFileSync(
      resolve(__dirname, 'delivery-repository.ts'),
      'utf-8',
    )
    const specifiers = importSpecifiers(source)
    // Stable module-specifier assertions: the repository persists via
    // Prisma/domain types and must never reach for a delivery transport.
    expect(specifiers).not.toContain('./email-delivery-sender')
    expect(specifiers).not.toContain('./push-delivery-sender')
    expect(specifiers).not.toContain('./delivery-senders')
    expect(specifiers).not.toContain('nodemailer')
    expect(specifiers).not.toContain('web-push')
    // Positive: the repository is persistence (Prisma + domain types).
    expect(specifiers).toContain('@spliit/db')
  })

  it('delivery-planner does not import provider scripts or workers', () => {
    const source = readFileSync(
      resolve(__dirname, 'delivery-planner.ts'),
      'utf-8',
    )
    const specifiers = importSpecifiers(source)
    expect(specifiers).not.toContain('./email-delivery-sender')
    expect(specifiers).not.toContain('./push-delivery-sender')
    expect(specifiers).not.toContain('./delivery-senders')
    expect(specifiers).not.toContain('./delivery-repository')
    // Positive: the planner composes channel policy + intent handlers and
    // persists snapshot/versioned rows via the snapshot schema (repository
    // layer), never via a sender transport.
    expect(specifiers).toContain('./coordinator-policy')
    expect(specifiers).toContain('./delivery-snapshot')
    expect(specifiers).toContain('./handlers')
  })

  it('no trpc-procedure producer imports worker-specific handler registration', () => {
    // Narrowed to producer modules (*.procedure.ts): the API surface that
    // plans notifications. Worker registration lives outside procedures;
    // procedures must enqueue via the planner, never import a worker handler.
    const trpcRoot = resolve(__dirname, '../../trpc/routers')
    const toProcess = [trpcRoot]
    const procedureFiles: string[] = []
    while (toProcess.length > 0) {
      const entry = toProcess.pop()!
      const stat = statSync(entry)
      if (stat.isDirectory()) {
        const children = readdirSync(entry)
        for (const child of children) {
          const childPath = join(entry, child)
          if (!childPath.includes('node_modules')) {
            toProcess.push(childPath)
          }
        }
        continue
      }
      if (!entry.endsWith('.procedure.ts')) continue
      procedureFiles.push(entry)
    }
    expect(procedureFiles.length).toBeGreaterThan(0)
    for (const file of procedureFiles) {
      const source = readFileSync(file, 'utf-8')
      const specifiers = importSpecifiers(source)
      // Ban worker transports by module specifier; domain type imports
      // (e.g. '@spliit/domain/notification-delivery') remain allowed.
      expect(specifiers).not.toContain(
        '../../../lib/notifications/delivery-senders',
      )
      expect(specifiers).not.toContain(
        '../../../lib/notifications/email-delivery-sender',
      )
      expect(specifiers).not.toContain(
        '../../../lib/notifications/push-delivery-sender',
      )
      expect(source).not.toMatch(
        /from\s+['"][^'"]*handleNotificationDelivery[^'"]*['"]/,
      )
    }
  })
})
