import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const repository = 'antonio-ivanovski/spliit-cloud'

export function readVersion(properties: string) {
  const versionName = /^versionName=(\d+\.\d+\.\d+)$/m.exec(properties)?.[1]
  const versionCode = Number(/^versionCode=(\d+)$/m.exec(properties)?.[1])
  if (
    !versionName ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2_100_000_000
  ) {
    throw new Error('Invalid Android version.properties')
  }
  return { versionName, versionCode }
}

export function releaseMetadata(
  properties: string,
  tag: string,
  apkName: string,
  sha256: string,
) {
  const version = readVersion(properties)
  if (tag !== `android/v${version.versionName}`)
    throw new Error('Release tag must match version.properties')
  if (apkName !== 'spliit-cloud.apk' || !/^[a-f0-9]{64}$/.test(sha256))
    throw new Error('Invalid signed APK artifact')
  return {
    schemaVersion: 1,
    packageName: 'cloud.spliit.twa',
    latest: {
      ...version,
      minSdk: 29,
      releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`,
      apkUrl: `https://github.com/${repository}/releases/download/${tag}/${apkName}`,
      sha256,
    },
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      apk: { type: 'string' },
      tag: { type: 'string' },
      output: { type: 'string' },
    },
    strict: true,
  })
  if (!values.apk || !values.tag || !values.output)
    throw new Error(
      'Usage: release:metadata --apk <signed spliit-cloud.apk> --tag android/vX.Y.Z --output <path>',
    )
  const apk = await readFile(values.apk)
  const properties = await readFile(
    resolve(import.meta.dir, '../version.properties'),
    'utf8',
  )
  const result = releaseMetadata(
    properties,
    values.tag,
    basename(values.apk),
    createHash('sha256').update(apk).digest('hex'),
  )
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`)
}
