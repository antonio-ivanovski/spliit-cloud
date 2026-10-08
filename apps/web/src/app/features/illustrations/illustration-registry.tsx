import type { ComponentType } from 'react'

import type { FeatureCatalogId } from '@/app/features/feature-registry'

import { AccountsSigninIllustration } from './accounts-signin-illustration'
import { ActivityIllustration } from './activity-illustration'
import { AiHelpIllustration } from './ai-help-illustration'
import { BalancesIllustration } from './balances-illustration'
import { BulkCategorizeIllustration } from './bulk-categorize-illustration'
import { CurrencyIllustration } from './currency-illustration'
import { DataPortabilityIllustration } from './data-portability-illustration'
import { DataSecurityIllustration } from './data-security-illustration'
import { DevelopersIllustration } from './developers-illustration'
import { ExpensesSplitsIllustration } from './expenses-splits-illustration'
import { FastEntryIllustration } from './fast-entry-illustration'
import { GroupsFriendsIllustration } from './groups-friends-illustration'
import { LanguagesIllustration } from './languages-illustration'
import { NotificationsIllustration } from './notifications-illustration'
import { OfflineAppIllustration } from './offline-app-illustration'
import { OpenSourceIllustration } from './open-source-illustration'
import { RecurringIllustration } from './recurring-illustration'
import { ShareIdentityIllustration } from './share-identity-illustration'
import { StatsBudgetsIllustration } from './stats-budgets-illustration'
import { WebhooksIllustration } from './webhooks-illustration'

/** Every catalog item owns exactly one static illustration. */
export const FEATURE_ILLUSTRATIONS: Record<FeatureCatalogId, ComponentType> = {
  'accounts-signin': AccountsSigninIllustration,
  'groups-friends': GroupsFriendsIllustration,
  'offline-app': OfflineAppIllustration,
  'data-security': DataSecurityIllustration,
  'expenses-splits': ExpensesSplitsIllustration,
  'fast-entry': FastEntryIllustration,
  currency: CurrencyIllustration,
  'ai-help': AiHelpIllustration,
  recurring: RecurringIllustration,
  'data-portability': DataPortabilityIllustration,
  'bulk-categorize': BulkCategorizeIllustration,
  'share-identity': ShareIdentityIllustration,
  activity: ActivityIllustration,
  notifications: NotificationsIllustration,
  languages: LanguagesIllustration,
  balances: BalancesIllustration,
  'stats-budgets': StatsBudgetsIllustration,
  developers: DevelopersIllustration,
  webhooks: WebhooksIllustration,
  'open-source': OpenSourceIllustration,
}
