import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { readVersion } from './release-metadata'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { apk: { type: 'string' }, fingerprint: { type: 'string' } },
})
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
if (!sdk || !values.apk || !values.fingerprint)
  throw new Error(
    'Set ANDROID_HOME and pass --apk <path> --fingerprint <app certificate SHA-256>',
  )
const expected = values.fingerprint.replaceAll(':', '').toLowerCase()
if (!/^[a-f0-9]{64}$/.test(expected))
  throw new Error('Invalid expected release certificate')
async function command(args: string[]) {
  const process = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exit !== 0) throw new Error(`${args[0]} failed: ${stderr}`)
  return stdout
}
const tools = resolve(sdk, 'build-tools/36.1.0')
const signature = await command([
  resolve(tools, 'apksigner'),
  'verify',
  '--verbose',
  '--print-certs',
  values.apk,
])
const actual = /Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)/
  .exec(signature)?.[1]
  ?.toLowerCase()
if (actual !== expected)
  throw new Error(
    'APK certificate does not match the expected production certificate',
  )
const badging = await command([
  resolve(tools, 'aapt2'),
  'dump',
  'badging',
  values.apk,
])
const version = readVersion(
  await readFile(resolve(import.meta.dir, '../version.properties'), 'utf8'),
)
const info =
  /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(
    badging,
  )
if (
  !info ||
  info[1] !== 'cloud.spliit.twa' ||
  Number(info[2]) !== version.versionCode ||
  info[3] !== version.versionName
) {
  throw new Error('APK identity/version does not match version.properties')
}
if (
  !/^(?:minSdkVersion|sdkVersion):'29'$/m.test(badging) ||
  !badging.includes("targetSdkVersion:'36'")
)
  throw new Error('APK SDK requirements have drifted')
const files = await command(['unzip', '-Z1', values.apk])
if (files.split('\n').some((file) => /^lib\/.*\.so$/.test(file)))
  throw new Error(
    'APK contains native libraries: review ABI and 16 KB alignment before releasing',
  )
console.log(
  `Verified production APK ${version.versionName} (${version.versionCode}), signature, SDK levels, and absence of native libraries.`,
)
