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

export const importDocumentPresignOutputSchema = z.object({
  uploadUrl: z.url(),
  stagedToken: z.string(),
})

export const cloudImportDocumentPresignOutputSchema = z.object({
  uploadUrl: z.url(),
  stagedToken: z.string(),
})
