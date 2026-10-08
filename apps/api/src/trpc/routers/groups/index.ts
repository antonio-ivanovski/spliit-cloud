import { createTRPCRouter } from '../../init'
import { activitiesRouter } from './activities'
import { archiveGroupProcedure } from './archive.procedure'
import { groupBalancesRouter } from './balances'
import { groupBudgetsRouter } from './budgets'
import { createGroupProcedure } from './create.procedure'
import { deleteGroupProcedure } from './delete.procedure'
import { dismissGroupEmojiIntroProcedure } from './dismissEmojiIntro.procedure'
import { groupExpensesRouter } from './expenses'
import { getGroupProcedure } from './get.procedure'
import { getGroupDetailsProcedure } from './getDetails.procedure'
import { importCloudBundleProcedure } from './import-cloud.procedure'
import { importGroupProcedure } from './import.procedure'
import { discoverImportDocumentsProcedure } from './importDocuments.procedure'
import { importLinksRouter } from './importLinks'
import { previewFromUrlProcedure } from './importPreview.procedure'
import {
  archiveGroupForSelfProcedure,
  leaveGroupProcedure,
  leavePreviewProcedure,
} from './leave.procedure'
import { listGroupsProcedure } from './list.procedure'
import { lookupGroupProcedure } from './lookup.procedure'
import { groupMembersRouter } from './members'
import { offlineCatalogProcedure } from './offline-catalog.procedure'
import { offlineSnapshotProcedure } from './offline-snapshot.procedure'
import { groupParticipantsRouter } from './participants'
import { groupReportsRouter } from './reports'
import { groupSavedViewsRouter } from './saved-views'
import { groupSplitPresetsRouter } from './split-presets'
import { groupStatsRouter } from './stats'
import { groupSubgroupsRouter } from './subgroups'
import { updateGroupProcedure } from './update.procedure'
import { groupViewRouter } from './view'

export const groupsRouter = createTRPCRouter({
  expenses: groupExpensesRouter,
  balances: groupBalancesRouter,
  stats: groupStatsRouter,
  activities: activitiesRouter,
  members: groupMembersRouter,
  participants: groupParticipantsRouter,
  importLinks: importLinksRouter,
  budgets: groupBudgetsRouter,
  subgroups: groupSubgroupsRouter,
  reports: groupReportsRouter,
  view: groupViewRouter,
  savedViews: groupSavedViewsRouter,
  splitPresets: groupSplitPresetsRouter,

  /**
   * Get a single group plus the caller's membership and link-invite state.
   * Public view (`viewKey`) and pending link invites (`linkInviteToken`) share
   * the same canonical group id.
   */
  get: getGroupProcedure,

  /**
   * Get a group with participants and whether it has expenses. Used by the
   * import flow.
   */
  getDetails: getGroupDetailsProcedure,

  list: listGroupsProcedure,

  /**
   * Offline catalog download: all ACTIVE memberships with live-computed
   * summaries. Cookie session only; no OAuth scope, no OpenAPI bearer
   * publication. Private/no-store.
   */
  offlineCatalog: offlineCatalogProcedure,

  /**
   * Offline group snapshot: coherent group + overview + balances + up to 500
   * newest expenses. Membership-only, never accepts link invites.
   * Private/no-store.
   */
  offlineSnapshot: offlineSnapshotProcedure,

  /**
   * Create a new group with ledger and participants. The caller becomes the
   * first ADMIN.
   */
  create: createGroupProcedure,

  /** Update a group's name, currency, information, or participants. */
  update: updateGroupProcedure,

  /**
   * Dismiss the group emoji intro for this group (ADMIN-only, group-wide).
   * Writes the declined sentinel so the prompt never reappears for any admin.
   */
  dismissEmojiIntro: dismissGroupEmojiIntroProcedure,

  /**
   * Archive or unarchive a group. Archived groups reject new expenses. Use
   * `force` to archive even when balances are non-zero.
   */
  archive: archiveGroupProcedure,

  /** Permanently delete a group and all its expenses. Irreversible. */
  delete: deleteGroupProcedure,

  /**
   * Leave a group. Requires `force` if you're the last admin or have non-zero
   * balances; pass `promoteMemberId` to transfer admin first.
   */
  leave: leaveGroupProcedure,

  /**
   * Preview the consequences of leaving: unsettled balances you'd forfeit and
   * members eligible for admin promotion.
   */
  leavePreview: leavePreviewProcedure,

  /** Hide the group from your list without affecting other members. Reversible. */
  archiveForSelf: archiveGroupForSelfProcedure,

  /**
   * Create or extend a group from parsed external data. When `targetGroupId` is
   * set, merges into an existing group; otherwise creates a new one from
   * `groupFormValues`.
   */
  import: importGroupProcedure,

  /** Restore a validated spliit.cloud group bundle into a new group. */
  importCloudBundle: importCloudBundleProcedure,

  /** Discover receipt images from the original public spliit.app group. */
  discoverImportDocuments: discoverImportDocumentsProcedure,

  /**
   * Fetch and parse a group from an external URL, returning a preview without
   * persisting anything.
   */
  importPreview: previewFromUrlProcedure,

  /**
   * Check whether a group was imported from an external source and return the
   * source provider + URL.
   */
  lookup: lookupGroupProcedure,
})
