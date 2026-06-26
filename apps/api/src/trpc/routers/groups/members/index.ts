import { createTRPCRouter } from '../../../init'
import { removeMemberProcedure } from './remove.procedure'
import { updateMemberRoleProcedure } from './updateRole.procedure'

/**
 * Group-member management router. All procedures require the caller to be
 * an active ADMIN of the group. Mutations are gated further inside each
 * procedure (e.g. `remove` rejects removing yourself so admins must use the
 * dedicated leave flow).
 */
export const groupMembersRouter = createTRPCRouter({
  updateRole: updateMemberRoleProcedure,
  remove: removeMemberProcedure,
})
