import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('notification architecture boundaries', () => {
  it('server.ts does not import legacy dispatcher initialization', () => {
    const source = readFileSync(resolve(__dirname, '../../server.ts'), 'utf-8')
    expect(source).not.toContain('initializeDefaultNotificationDispatchers')
  })

  it('delivery-repository does not import provider-level senders', () => {
    const source = readFileSync(
      resolve(__dirname, 'delivery-repository.ts'),
      'utf-8',
    )
    expect(source).not.toContain('sendEmail')
    expect(source).not.toContain('sendPushNotification')
    expect(source).not.toContain('nodemailer')
    expect(source).not.toContain('web-push')
  })

  it('delivery-planner does not import provider scripts or workers', () => {
    const source = readFileSync(
      resolve(__dirname, 'delivery-planner.ts'),
      'utf-8',
    )
    expect(source).not.toContain('sendEmail')
    expect(source).not.toContain('sendPushNotification')
    expect(source).not.toContain('email-delivery-sender')
    expect(source).not.toContain('push-delivery-sender')
  })

  it('no trpc-procedure producer imports worker-specific handler registration', () => {
    const trpcRoot = resolve(__dirname, '../../trpc/routers')
    const toProcess = [trpcRoot]
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
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
      if (entry.includes('.test.') || entry.includes('.spec.')) continue
      const source = readFileSync(entry, 'utf-8')
      expect(source).not.toContain('notification-delivery')
      expect(source).not.toContain('handleNotificationDelivery')
    }
  })
})
