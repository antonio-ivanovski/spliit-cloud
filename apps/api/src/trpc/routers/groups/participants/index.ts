import { createTRPCRouter } from '../../../init'
import {
  removeParticipantPreviewProcedure,
  removeParticipantProcedure,
} from './remove.procedure'

export const groupParticipantsRouter = createTRPCRouter({
  removePreview: removeParticipantPreviewProcedure,
  remove: removeParticipantProcedure,
})
