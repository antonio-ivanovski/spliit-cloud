/**
 * S3 ↔ local uploads migration script.
 *
 * Copies every stored object (expense documents + account profile images) from
 * the currently-configured upload backend to the other one, and — with
 * `--rewrite` — points the database at the destination URLs.
 *
 * Direction is inferred from the environment: if `UPLOADS_DRIVER=local` the
 * local filesystem is the source and S3 is the destination; otherwise S3/R2 is
 * the source and the local filesystem is the destination.
 *
 * Usage (from `apps/api`):
 *
 * Bun --env-file=../../.env scripts/migrate-uploads.ts --dry-run # report only
 * bun --env-file=../../.env scripts/migrate-uploads.ts # copy, keep URLs bun
 * --env-file=../../.env scripts/migrate-uploads.ts --rewrite # copy + rewrite
 * URLs
 *
 * Before running with `--rewrite`, back up the uploads volume (docker compose
 * creates one at `uploads_data`) and/or the S3 bucket — the copy is idempotent
 * but the DB rewrite is one-way.
 */

import { prisma } from '@spliit/db'
import { MAX_EXPENSE_DOCUMENT_SIZE } from '@spliit/domain'

import { env } from '../src/lib/env'
import {
  getStorageDriver,
  ObjectNotFoundError,
  objectBodyToBytes,
} from '../src/lib/storage'
import { createLocalDriver } from '../src/lib/storage/local'
import { createS3Driver } from '../src/lib/storage/s3'
import type { StorageDriver } from '../src/lib/storage/types'
import { MAX_PROFILE_IMAGE_SIZE } from '../src/routes/upload'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const rewrite = args.has('--rewrite')

type MigratableObject = {
  kind: 'document' | 'profile-image'
  id: string
  url: string
  maxSize: number
  setUrl: (url: string) => Promise<void>
}

async function collectObjects(): Promise<MigratableObject[]> {
  const objects: MigratableObject[] = []

  const documents = await prisma.expenseDocument.findMany({
    select: { id: true, url: true },
  })
  for (const document of documents) {
    objects.push({
      kind: 'document',
      id: document.id,
      url: document.url,
      maxSize: MAX_EXPENSE_DOCUMENT_SIZE,
      setUrl: async (url) => {
        await prisma.expenseDocument.update({
          where: { id: document.id },
          data: { url },
        })
      },
    })
  }

  const accounts = await prisma.account.findMany({
    where: { image: { not: null } },
    select: { id: true, image: true },
  })
  for (const account of accounts) {
    if (!account.image) continue
    objects.push({
      kind: 'profile-image',
      id: account.id,
      url: account.image,
      maxSize: MAX_PROFILE_IMAGE_SIZE,
      setUrl: async (url) => {
        await prisma.account.update({
          where: { id: account.id },
          data: { image: url },
        })
      },
    })
  }

  return objects
}

function buildDestinationDriver(source: StorageDriver): StorageDriver {
  if (source.kind === 'local') return createS3Driver()
  return createLocalDriver(env.UPLOADS_DIR ?? '/uploads')
}

async function main() {
  const source = getStorageDriver()
  const destination = buildDestinationDriver(source)

  if (!source.uploadsConfigured()) {
    throw new Error(
      'Source upload backend is not configured (missing S3_UPLOAD_* or UPLOADS_DIR).',
    )
  }
  if (!destination.uploadsConfigured()) {
    throw new Error(
      'Destination upload backend is not configured (missing S3_UPLOAD_* or UPLOADS_DIR).',
    )
  }

  const objects = await collectObjects()
  if (objects.length === 0) {
    console.log('No uploads to migrate.')
    return
  }
  console.log(
    `Migrating ${objects.length} object(s) from ${source.kind} to ${destination.kind}${dryRun ? ' (dry run)' : ''}.`,
  )

  let copied = 0
  let skipped = 0
  let rewritten = 0
  const failed: string[] = []

  for (const object of objects) {
    let key: string
    try {
      key = source.keyFromFileUrl(object.url)
    } catch (cause) {
      failed.push(
        `${object.kind} ${object.id}: cannot derive key from ${object.url} (${String(cause)})`,
      )
      continue
    }

    if (dryRun) {
      console.log(`  would copy ${source.kind}:${key}`)
      copied++
      continue
    }

    try {
      const { body, contentType } = await source.getObject(key)
      const bytes = await objectBodyToBytes(body)
      await destination.putObject({
        key,
        body: bytes,
        contentType: contentType ?? 'application/octet-stream',
        maxSize: object.maxSize,
      })
      copied++
    } catch (cause) {
      if (cause instanceof ObjectNotFoundError) {
        skipped++
        console.log(`  skip missing ${source.kind}:${key}`)
      } else {
        failed.push(`${object.kind} ${object.id} (${key}): ${String(cause)}`)
      }
      continue
    }

    if (rewrite) {
      const to = destination.publicUrlForKey(key)
      await object.setUrl(to)
      rewritten++
    }
  }

  console.log(
    `Done: ${copied} copied, ${skipped} skipped, ${failed.length} failed.`,
  )
  if (rewrite) console.log(`Database URLs rewritten: ${rewritten}.`)
  if (failed.length > 0) {
    for (const message of failed) console.error(`  FAILED ${message}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('Uploads migration failed:', err)
  process.exit(1)
})
