import { parseArgs } from 'node:util'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    fingerprint: { type: 'string' },
    origin: { type: 'string' },
    package: { type: 'string' },
  },
})
const compact = values.fingerprint?.replaceAll(':', '').toUpperCase()
if (!compact || !/^[A-F0-9]{64}$/.test(compact))
  throw new Error('Supply --fingerprint <release certificate SHA-256>')
const origin = new URL(values.origin ?? 'https://spliit.cloud').origin
if (!origin.startsWith('https://'))
  throw new Error('Digital Asset Links requires HTTPS')
const response = await fetch(`${origin}/.well-known/assetlinks.json`, {
  redirect: 'manual',
  signal: AbortSignal.timeout(15_000),
})
if (
  response.status !== 200 ||
  !response.headers.get('content-type')?.includes('application/json')
) {
  throw new Error(
    `Asset Links must return JSON with HTTP 200 and no redirects (received ${response.status})`,
  )
}
type Statement = {
  relation?: string[]
  target?: {
    namespace?: string
    package_name?: string
    sha256_cert_fingerprints?: string[]
  }
}
const statements: Statement[] = await response.json()
const found =
  Array.isArray(statements) &&
  statements.some(
    (statement) =>
      statement.relation?.includes(
        'delegate_permission/common.handle_all_urls',
      ) &&
      statement.target?.namespace === 'android_app' &&
      statement.target.package_name ===
        (values.package ?? 'cloud.spliit.twa') &&
      statement.target.sha256_cert_fingerprints?.some(
        (fingerprint) =>
          /^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/.test(fingerprint) &&
          fingerprint.replaceAll(':', '') === compact,
      ),
  )
if (!found)
  throw new Error(
    'Release certificate/package claim not found in live Digital Asset Links',
  )
console.log(
  'Live Digital Asset Links matches the release certificate. Also verify on-device with adb shell pm get-app-links.',
)
