import ca from '@/messages/ca.json'
import csCZ from '@/messages/cs-CZ.json'
import deDE from '@/messages/de-DE.json'
import es from '@/messages/es.json'
import eu from '@/messages/eu.json'
import fi from '@/messages/fi.json'
import frFR from '@/messages/fr-FR.json'
import he from '@/messages/he.json'
import id from '@/messages/id.json'
import itIT from '@/messages/it-IT.json'
import jaJP from '@/messages/ja-JP.json'
import ko from '@/messages/ko.json'
import nlNL from '@/messages/nl-NL.json'
import plPL from '@/messages/pl-PL.json'
import ptBR from '@/messages/pt-BR.json'
import pt from '@/messages/pt.json'
import ro from '@/messages/ro.json'
import ruRU from '@/messages/ru-RU.json'
import trTR from '@/messages/tr-TR.json'
import ukUA from '@/messages/uk-UA.json'
import zhCN from '@/messages/zh-CN.json'
import zhTW from '@/messages/zh-TW.json'
import type { DeepPartial, DefaultMessages } from './types'

// Compile-time only: ensures every non-default locale's JSON is a deep
// partial of the canonical English schema. Imported solely for its type
// side-effect; bundlers tree-shake this module from runtime output.
const _locales = {
  ca,
  'cs-CZ': csCZ,
  'de-DE': deDE,
  es,
  eu,
  fi,
  'fr-FR': frFR,
  he,
  id,
  'it-IT': itIT,
  'ja-JP': jaJP,
  ko,
  'nl-NL': nlNL,
  'pl-PL': plPL,
  pt,
  'pt-BR': ptBR,
  ro,
  'ru-RU': ruRU,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} satisfies Record<string, DeepPartial<DefaultMessages>>

void _locales
