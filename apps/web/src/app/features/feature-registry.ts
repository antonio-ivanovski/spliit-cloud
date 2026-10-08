import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Bookmark,
  Code2,
  Coins,
  FingerprintPattern,
  GitFork,
  History,
  Languages,
  QrCode,
  Receipt,
  Repeat,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tags,
  Upload,
  Users,
  Webhook,
} from 'lucide-react'

export type FeatureSectionId =
  | 'foundation'
  | 'everyday'
  | 'power'
  | 'sharing'
  | 'insights'
  | 'developers'

export type FeatureCatalogId =
  | 'accounts-signin'
  | 'groups-friends'
  | 'offline-app'
  | 'data-security'
  | 'expenses-splits'
  | 'fast-entry'
  | 'currency'
  | 'ai-help'
  | 'recurring'
  | 'data-portability'
  | 'bulk-categorize'
  | 'share-identity'
  | 'activity'
  | 'notifications'
  | 'languages'
  | 'balances'
  | 'stats-budgets'
  | 'developers'
  | 'webhooks'
  | 'open-source'

export type FeatureItem = {
  id: FeatureCatalogId
  icon: LucideIcon
}

export type FeatureSection = {
  id: FeatureSectionId
  items: FeatureItem[]
}

/**
 * Registry for the public features page. Static listings live here with
 * title/description keys under `Features.catalog.<id>`; sections own
 * `Features.sections.<id>.title`. Each item renders its static illustration
 * from `./illustrations/illustration-registry` as a top banner inside its
 * card.
 */
export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'foundation',
    items: [
      { id: 'accounts-signin', icon: FingerprintPattern },
      { id: 'groups-friends', icon: Users },
      { id: 'offline-app', icon: Smartphone },
      { id: 'data-security', icon: ShieldCheck },
    ],
  },
  {
    id: 'everyday',
    items: [
      { id: 'expenses-splits', icon: Receipt },
      { id: 'fast-entry', icon: Bookmark },
      { id: 'currency', icon: Coins },
      { id: 'ai-help', icon: Sparkles },
    ],
  },
  {
    id: 'power',
    items: [
      { id: 'recurring', icon: Repeat },
      { id: 'data-portability', icon: Upload },
      { id: 'bulk-categorize', icon: Tags },
    ],
  },
  {
    id: 'sharing',
    items: [
      { id: 'share-identity', icon: QrCode },
      { id: 'activity', icon: History },
      { id: 'notifications', icon: Bell },
      { id: 'languages', icon: Languages },
    ],
  },
  {
    id: 'insights',
    items: [
      { id: 'balances', icon: ArrowLeftRight },
      { id: 'stats-budgets', icon: BarChart3 },
    ],
  },
  {
    id: 'developers',
    items: [
      { id: 'developers', icon: Code2 },
      { id: 'webhooks', icon: Webhook },
      { id: 'open-source', icon: GitFork },
    ],
  },
]
