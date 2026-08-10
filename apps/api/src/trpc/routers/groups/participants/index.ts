import { createTRPCRouter } from '../../../init'
import { createParticipantProcedure } from './create.procedure'
import {
  removeParticipantPreviewProcedure,
  removeParticipantProcedure,
} from './remove.procedure'

export const groupParticipantsRouter = createTRPCRouter({
  create: createParticipantProcedure,
  removePreview: removeParticipantPreviewProcedure,
  remove: removeParticipantProcedure,
})
