import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Locale } from '../../../packages/domain/src/i18n.ts'

export const LOCALE_TO_FILE: Record<Locale, string> = {
  'en-US': 'en-US.json',
  ca: 'ca.json',
  'cs-CZ': 'cs-CZ.json',
  'de-DE': 'de-DE.json',
  es: 'es.json',
  eu: 'eu.json',
  fi: 'fi.json',
  'fr-FR': 'fr-FR.json',
  he: 'he.json',
  id: 'id.json',
  'it-IT': 'it-IT.json',
  'ja-JP': 'ja-JP.json',
  ko: 'ko.json',
  'mk-MK': 'mk-MK.json',
  'nl-NL': 'nl-NL.json',
  'pl-PL': 'pl-PL.json',
  pt: 'pt.json',
  'pt-BR': 'pt-BR.json',
  ro: 'ro.json',
  'ru-RU': 'ru-RU.json',
  'tr-TR': 'tr-TR.json',
  'uk-UA': 'uk-UA.json',
  'zh-CN': 'zh-CN.json',
  'zh-TW': 'zh-TW.json',
}

let messagesDir: string = join(process.cwd(), 'apps/web/src/messages')

export function getMessagesDir(): string {
  return messagesDir
}

export function setMessagesDir(dir: string): void {
  messagesDir = dir
}

function fileFor(locale: Locale): string {
  return join(messagesDir, LOCALE_TO_FILE[locale])
}

function gitPathFor(locale: Locale): string {
  return `apps/web/src/messages/${LOCALE_TO_FILE[locale]}`
}

export async function readMessagesFile(
  locale: Locale,
): Promise<Record<string, unknown>> {
  const content = await readFile(fileFor(locale), 'utf8')
  return JSON.parse(content)
}

export async function writeMessagesFile(
  locale: Locale,
  data: Record<string, unknown>,
): Promise<void> {
  const content = JSON.stringify(data, null, 2) + '\n'
  await writeFile(fileFor(locale), content)
}

export async function readGitBlob(
  ref: string,
  locale: Locale,
): Promise<Record<string, unknown> | null> {
  const relPath = gitPathFor(locale)
  try {
    const content = execSync(`git show ${ref}:${relPath}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(content)
  } catch {
    return null
  }
}

export async function readStagedBlob(
  locale: Locale,
): Promise<Record<string, unknown> | null> {
  const relPath = gitPathFor(locale)
  try {
    const content = execSync(`git show :${relPath}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(content)
  } catch {
    return null
  }
}
