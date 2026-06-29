import { readFileSync } from 'node:fs'
import {
  addString,
  auditMessages,
  diffMessages,
  flattenKeys,
  getAt,
  missingKeys,
  missingKeysByLocale,
  readMessagesFile,
  removeString,
  setString,
  validateAllMessages,
} from './lib'
import type { AuditResult } from './lib.ts'
import { locales, type Locale } from './lib.ts'

type ParsedArgs = {
  positional: string[]
  flags: Set<string>
  kvFlags: Record<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Set<string>()
  const kvFlags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        kvFlags[key] = next
        i++
      } else {
        flags.add(key)
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags, kvFlags }
}

function die(msg: string, code = 1): never {
  console.error(`error: ${msg}`)
  process.exit(code)
}

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

function formatDiffHuman(result: Awaited<ReturnType<typeof diffMessages>>) {
  const lines: string[] = []
  const { ref, thisChange, translationWork, legacyMissing } = result

  lines.push(`This change (vs ${ref}):`)
  lines.push(`  + ${thisChange.added.length} added`)
  for (const k of thisChange.added) lines.push(`    ${k}`)
  lines.push(`  ~ ${thisChange.modified.length} modified`)
  for (const k of thisChange.modified) lines.push(`    ${k}`)
  lines.push(`  - ${thisChange.removed.length} removed`)
  for (const k of thisChange.removed) lines.push(`    ${k}`)

  const localeKeys = Object.keys(translationWork)
  if (localeKeys.length === 0) {
    lines.push('')
    lines.push('No non-default locales to translate.')
  } else {
    lines.push('')
    lines.push('Translation work introduced by this change:')
    const maxLen = Math.max(...localeKeys.map((k) => k.length))
    for (const locale of localeKeys) {
      const { missing, present } = translationWork[locale]
      const padded = locale.padEnd(maxLen)
      lines.push(
        `  ${padded}  ${missing.length} missing / ${present.length} present`,
      )
    }

    const single = localeKeys.length === 1
    if (single) {
      const locale = localeKeys[0]
      const { missing, present } = translationWork[locale]
      if (missing.length > 0) {
        lines.push('')
        lines.push(`${locale} (missing):`)
        for (const k of missing) lines.push(`  - ${k}`)
      }
      if (present.length > 0) {
        lines.push('')
        lines.push(
          `${locale} (present — may need re-check if English changed):`,
        )
        for (const k of present) lines.push(`  + ${k}`)
      }
    }
  }

  const legacyKeys = Object.keys(legacyMissing)
  if (legacyKeys.length > 0) {
    lines.push('')
    lines.push('Legacy debt (pre-existing missing keys, unchanged by this PR):')
    const maxLen = Math.max(...legacyKeys.map((k) => k.length))
    for (const locale of legacyKeys) {
      const padded = locale.padEnd(maxLen)
      lines.push(`  ${padded}  ${legacyMissing[locale]}`)
    }
  }

  return lines.join('\n')
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function printCheckHuman(result: AuditResult) {
  const { totalKeys, locales, summary, errors, valid, changesOnly, ref } =
    result

  console.log(`i18n audit${changesOnly ? ` (changes vs ${ref})` : ''}`)
  console.log(`  en-US source: ${totalKeys} keys`)
  console.log(
    `  locales: ${summary.localesAudited} audited, ${summary.localesComplete} complete, ${summary.localesWithMissing} with gaps`,
  )
  console.log(`  total missing keys: ${summary.totalMissing}`)
  if (errors.length > 0) {
    console.log(`  structural errors: ${errors.length}`)
  }

  const audited = Object.values(locales).sort((a, b) => {
    if (a.missing !== b.missing) return b.missing - a.missing
    return a.locale.localeCompare(b.locale)
  })

  const localeCol = Math.max(
    'locale'.length,
    ...audited.map((a) => a.locale.length),
  )

  if (audited.length > 0) {
    console.log('')
    console.log(
      `  ${'locale'.padEnd(localeCol)}  ${'present'.padStart(7)}  ${'missing'.padStart(7)}  ${'coverage'.padStart(9)}`,
    )
    for (const a of audited) {
      console.log(
        `  ${a.locale.padEnd(localeCol)}  ${String(a.present).padStart(7)}  ${String(a.missing).padStart(7)}  ${formatPercent(a.coverage).padStart(9)}`,
      )
    }
  }

  const incomplete = audited.filter((a) => a.missing > 0)
  if (incomplete.length > 0) {
    console.log('')
    for (const a of incomplete) {
      console.log(`  ${a.locale} (${a.missing} missing):`)
      for (const k of a.missingKeys) console.log(`    - ${k}`)
    }
  }

  if (errors.length > 0) {
    console.log('')
    console.log('  structural errors:')
    for (const e of errors) console.log(`    ${e}`)
  }

  if (valid && summary.totalMissing === 0) {
    console.log('')
    console.log('  OK — all locales in sync with en-US.')
  } else {
    console.log('')
    console.log('  FAIL — see above.')
  }
}

function help() {
  return [
    'Usage: bun i18n <command> [args]',
    '',
    'Commands:',
    '  add <path> "<value>"            Add a key to en-US (creates intermediate objects).',
    '  add --stdin                     Read {"path": "value", ...} from stdin and add to en-US.',
    '  set <locale> <path> "<value>"   Set a translation in any single locale.',
    '  remove <path>                   Remove a key from en-US and all other locales (cleanup).',
    '  get <locale> <path>             Print the current value at a path.',
    '  list [locale]                   Print flat dotted keys (defaults to en-US).',
    '  missing [--locale <l>] [--all] [--json]',
    '                                  List keys missing in a locale (vs en-US).',
    '                                  With --all, list missing keys for every non-en-US locale.',
    '  diff [--staged] [--ref <r>] [--locale <l>] [--json]',
    '                                  Show changes vs git, partitioned by translation work.',
    '  check [--changes-only] [--locale <l>] [--ref <r>] [--json]',
    '                                  Audit all locales. Exits 1 on orphan keys or missing keys.',
    '                                  --changes-only: only flag missing keys introduced by the diff vs ref.',
    '  validate                        JSON-parse and check for orphan keys.',
    '  help                            Show this help.',
    '',
    'Exit codes:',
    '  0  clean',
    '  1  issues found (orphan keys or missing keys for `check` / `validate`)',
    '  2  usage error or unknown locale / key',
    '',
    'Notes:',
    '  - `add` and `remove` only touch en-US.json.',
    '  - Use `set` to fill in a translation in another locale.',
    '  - Use `diff` to see what new translations a change introduces.',
    '  - Use `check` as the canonical CI gate: `bun i18n check` exits 1 if any',
    '    non-en-US locale is missing any key present in en-US.',
  ].join('\n')
}

async function main() {
  const { positional, flags, kvFlags } = parseArgs(process.argv.slice(2))
  const cmd = positional[0]

  if (!cmd || cmd === 'help' || flags.has('help')) {
    console.log(help())
    return
  }

  switch (cmd) {
    case 'add': {
      if (flags.has('stdin')) {
        const raw = readFileSync(0, 'utf8')
        const obj = JSON.parse(raw) as Record<string, unknown>
        let count = 0
        for (const [path, value] of Object.entries(obj)) {
          if (typeof value !== 'string') {
            die(`value for "${path}" must be a string`)
          }
          await addString(path, value)
          count++
        }
        console.log(`Added ${count} key(s) to en-US.`)
        return
      }
      const path = positional[1]
      const value = positional[2]
      if (!path || value === undefined) {
        die('usage: bun i18n add <path> "<value>"')
      }
      await addString(path, value)
      console.log(`Added ${path} to en-US.`)
      return
    }

    case 'set': {
      const locale = positional[1]
      const path = positional[2]
      const value = positional[3]
      if (!locale || !path || value === undefined) {
        die('usage: bun i18n set <locale> <path> "<value>"')
      }
      if (!isLocale(locale)) {
        die(`unknown locale: ${locale}`)
      }
      await setString(locale, path, value)
      console.log(`Set ${path} in ${locale}.`)
      return
    }

    case 'remove': {
      const path = positional[1]
      if (!path) die('usage: bun i18n remove <path>')
      const count = await removeString(path)
      if (count === 0) {
        console.log(`Nothing to remove: ${path} not present in en-US.`)
        return
      }
      console.log(`Removed ${path} from ${count} locale(s).`)
      return
    }

    case 'get': {
      const locale = positional[1]
      const path = positional[2]
      if (!locale || !path) die('usage: bun i18n get <locale> <path>')
      if (!isLocale(locale)) die(`unknown locale: ${locale}`)
      const data = await readMessagesFile(locale)
      const value = getAt(data, path)
      if (value === undefined) {
        console.log(`(undefined)`)
        process.exit(2)
      }
      console.log(typeof value === 'string' ? value : JSON.stringify(value))
      return
    }

    case 'list': {
      const locale = (positional[1] ?? 'en-US') as Locale
      if (!isLocale(locale)) die(`unknown locale: ${locale}`)
      const data = await readMessagesFile(locale)
      const keys = flattenKeys(data)
      for (const k of keys) console.log(k)
      return
    }

    case 'missing': {
      const json = flags.has('json')
      if (flags.has('all')) {
        if (kvFlags.locale) {
          die('--all and --locale are mutually exclusive')
        }
        const allMissing = await missingKeysByLocale()
        if (json) {
          console.log(JSON.stringify(allMissing, null, 2))
        } else {
          let total = 0
          for (const locale of locales.filter((l) => l !== 'en-US')) {
            const missing = allMissing[locale]
            total += missing.length
            console.log(`${locale}: ${missing.length} missing`)
          }
          console.log(`Total: ${total} missing across all locales.`)
        }
        return
      }
      const locale = kvFlags.locale as Locale | undefined
      const target = locale ?? 'en-US'
      if (!isLocale(target)) die(`unknown locale: ${target}`)
      if (target === 'en-US') {
        die('missing is not meaningful for en-US (it is the source of truth)')
      }
      const missing = await missingKeys(target)
      if (json) {
        console.log(JSON.stringify({ locale: target, missing }, null, 2))
      } else {
        console.log(`${missing.length} key(s) missing in ${target}:`)
        for (const k of missing) console.log(`  ${k}`)
      }
      return
    }

    case 'diff': {
      const staged = flags.has('staged')
      const ref = kvFlags.ref
      const locale = kvFlags.locale as Locale | undefined
      const json = flags.has('json')
      if (locale && !isLocale(locale)) die(`unknown locale: ${locale}`)
      const result = await diffMessages({ staged, ref, locale })
      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatDiffHuman(result))
      }
      return
    }

    case 'validate': {
      const result = await validateAllMessages()
      if (result.valid) {
        console.log(`All ${locales.length} message files valid.`)
        return
      }
      console.error(`Found ${result.errors.length} error(s):`)
      for (const e of result.errors) console.error(`  ${e}`)
      process.exit(1)
    }

    case 'check': {
      const json = flags.has('json')
      const changesOnly = flags.has('changes-only')
      const locale = kvFlags.locale as Locale | undefined
      const ref = kvFlags.ref
      if (locale && !isLocale(locale)) die(`unknown locale: ${locale}`)
      if (locale === 'en-US') {
        die('check is not meaningful for en-US (it is the source of truth)')
      }

      const result = await auditMessages({ changesOnly, locale, ref })

      if (json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        printCheckHuman(result)
      }

      if (!result.valid || result.summary.totalMissing > 0) {
        process.exit(1)
      }
      return
    }

    default:
      die(`unknown command: ${cmd}\n\n${help()}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
