import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync('bun', [cli, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000,
  })
}

describe('development seed command safety', () => {
  it.each(['production', 'test', ''])(
    'refuses mode %j before attempting a database connection',
    (mode) => {
      const result = run(['--account=maintainer@example.test'], {
        NODE_ENV: mode,
        DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/no_database',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Dev seed requires NODE_ENV=development')
    },
  )

  it.each([
    'postgresql://user:password@db.production.example/app',
    'postgresql://user:password@localhost.production.example/app',
    'https://localhost/app',
  ])('rejects unsafe database targets without echoing credentials', (url) => {
    const result = run(['--account=maintainer@example.test'], {
      NODE_ENV: 'development',
      DATABASE_URL: url,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('loopback PostgreSQL')
    expect(result.stderr).not.toContain('password')
  })

  it('previews fixtures without needing a reachable database', () => {
    const result = run(['--account=maintainer@example.test', '--dry-run'], {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/no_database',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No database connection')
    expect(result.stdout).toContain('Shared household')
  })

  it('rejects query parameters that could override the verified loopback host', () => {
    const result = run(['--account=maintainer@example.test'], {
      NODE_ENV: 'development',
      DATABASE_URL:
        'postgresql://user:password@localhost/app?host=db.production.example',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refuses DATABASE_URL query parameters')
  })

  it('rejects ambiguous reset/clean requests', () => {
    const result = run(
      ['--account=maintainer@example.test', '--reset', '--clean'],
      {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/no_database',
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Choose either --reset or --clean')
  })
})
