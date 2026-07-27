import { z } from 'zod'

export const uploadPresignOutputSchema = z.object({
  uploadUrl: z.string().url(),
  fileUrl: z.string().url(),
  key: z.string(),
})

export const profileImagePresignOutputSchema = z.object({
  uploadUrl: z.string().url(),
  fileUrl: z.string().url(),
})
