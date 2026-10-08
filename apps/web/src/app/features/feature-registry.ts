import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Calculator,
  Code2,
  Coins,
  FileDown,
  History,
  KeyRound,
  Palette,
  QrCode,
  Receipt,
  Repeat,
  Sparkles,
  Tags,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'

export type FeatureSectionId =
  | 'foundation'
  | 'everyday'
  | 'power'
  | 'sharing'
  | 'insights'
  | 'developers'

export type FeatureCatalogId =
  | 'anonymous-accounts'
  | 'passkeys-security'
  | 'synced-groups'
  | 'core-expenses'
  | 'multi-payer'
  | 'calculator'
  | 'currency'
  | 'ai-assist'
  | 'recurring'
  | 'bulk-categorize'
  | 'import'
  | 'export'
  | 'archive'
  | 'qr-sharing'
  | 'identity'
  | 'activity'
  | 'balances'
  | 'stats-budgets'
  | 'notifications'
  | 'developers'

export type FeatureItem = {
  id: FeatureCatalogId
  icon: LucideIcon
  /** Set when the card links somewhere real; otherwise a static listing. */
  href?: string
  /** Only one item owns the interactive demo in v1; the rest are static. */
  demo?: 'split-settle'
}

export type FeatureSection = {
  id: FeatureSectionId
  items: FeatureItem[]
}

/**
 * Registry for the public features page. Static listings live here with
 * title/description keys under `Features.catalog.<id>`; sections own
 * `Features.sections.<id>.title`. Add new interactive demos by setting `demo`
 * on an item and rendering it in the page — no layout refactor.
 */
export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'foundation',
    items: [
      { id: 'anonymous-accounts', icon: UserRound },
      { id: 'passkeys-security', icon: KeyRound },
      { id: 'synced-groups', icon: Users },
    ],
  },
  {
    id: 'everyday',
    items: [
      { id: 'core-expenses', icon: Receipt, demo: 'split-settle' },
      { id: 'multi-payer', icon: Users },
      { id: 'calculator', icon: Calculator },
      { id: 'currency', icon: Coins },
      { id: 'ai-assist', icon: Sparkles },
    ],
  },
  {
    id: 'power',
    items: [
      { id: 'recurring', icon: Repeat },
      { id: 'bulk-categorize', icon: Tags },
      { id: 'import', icon: Upload },
      { id: 'export', icon: FileDown },
      { id: 'archive', icon: Archive },
    ],
  },
  {
    id: 'sharing',
    items: [
      { id: 'qr-sharing', icon: QrCode },
      { id: 'identity', icon: Palette },
      { id: 'activity', icon: History },
    ],
  },
  {
    id: 'insights',
    items: [
      { id: 'balances', icon: ArrowLeftRight, demo: 'split-settle' },
      { id: 'stats-budgets', icon: BarChart3 },
      { id: 'notifications', icon: Bell },
    ],
  },
  {
    id: 'developers',
    items: [{ id: 'developers', icon: Code2 }],
  },
]

/** Catalog ids that point at the live demo section instead of a static card. */
export const DEMO_ITEM_IDS = new Set(
  FEATURE_SECTIONS.flatMap((s) => s.items)
    .filter((item) => item.demo === 'split-settle')
    .map((item) => item.id),
)
