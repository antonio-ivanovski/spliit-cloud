#!/usr/bin/env bun
/**
 * Start local dev services (postgres, maxio, maildev) with host-owned data.
 *
 * Docker creates missing bind-mount directories as root, which leaves the maxio
 * (image uid 999) and maildev (image uid 1000) data directories unwritable on a
 * fresh checkout. Pre-creating `storage/*` here — combined with `user:
 * ${UID}:${GID}` in compose.dev.yaml — keeps everything owned by the invoking
 * user. Run via `bun dev:up`.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

for (const dir of ['postgres', 'maxio', 'maildev']) {
  mkdirSync(join(root, 'storage', dir), { recursive: true })
}

const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
const gid = typeof process.getgid === 'function' ? process.getgid() : 1000

const result = Bun.spawnSync(
  ['docker', 'compose', '-f', 'compose.dev.yaml', 'up', '-d', '--wait'],
  {
    cwd: root,
    env: { ...process.env, UID: String(uid), GID: String(gid) },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
)
process.exit(result.exitCode ?? 1)
