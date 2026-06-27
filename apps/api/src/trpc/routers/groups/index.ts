import { createTRPCRouter } from '../../init'
import { activitiesRouter } from './activities'
import { archiveGroupProcedure } from './archive.procedure'
import { groupBalancesRouter } from './balances'
import { createGroupProcedure } from './create.procedure'
import { groupExpensesRouter } from './expenses'
import { getGroupProcedure } from './get.procedure'
import { getGroupDetailsProcedure } from './getDetails.procedure'
import { importGroupProcedure } from './import.procedure'
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
import { groupStatsRouter } from './stats'
import { updateGroupProcedure } from './update.procedure'

export const groupsRouter = createTRPCRouter({
  expenses: groupExpensesRouter,
  balances: groupBalancesRouter,
  stats: groupStatsRouter,
  activities: activitiesRouter,
  members: groupMembersRouter,
  importLinks: importLinksRouter,

  get: getGroupProcedure,
  getDetails: getGroupDetailsProcedure,
  list: listGroupsProcedure,
  create: createGroupProcedure,
  update: updateGroupProcedure,
  archive: archiveGroupProcedure,
  leave: leaveGroupProcedure,
  leavePreview: leavePreviewProcedure,
  archiveForSelf: archiveGroupForSelfProcedure,
  import: importGroupProcedure,
  importPreview: previewFromUrlProcedure,
  lookup: lookupGroupProcedure,
})
