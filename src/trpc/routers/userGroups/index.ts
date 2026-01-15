import { createTRPCRouter } from '@/trpc/init'
import { listUserGroups } from './list.procedure'
import { joinUserGroup } from './join.procedure'

export const userGroupsRouter = createTRPCRouter({
  list: listUserGroups,
  join: joinUserGroup,
})
