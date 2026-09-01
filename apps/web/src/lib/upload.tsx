import { useMutation } from '@tanstack/react-query'

import { trpc } from '@/trpc/client'

const MAX_DIMENSION = 2560
const JPEG_QUALITY = 0.8
const PROFILE_IMAGE_DIMENSION = 512
const HEIC_TYPES = new Set(['image/heic', 'image/heif'])

export async function getImageData(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Cannot read image dimensions'))
    })
    image.src = url
    await loaded
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

async function decodeHeic(file: File): Promise<File> {
  const { heicTo } = await import('heic-to')
  const blob = await heicTo({
    blob: file,
    type: 'image/jpeg',
    quality: JPEG_QUALITY,
  })
  return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', {
    type: 'image/jpeg',
  })
}

export async function maybeDecodeHeic(file: File): Promise<File> {
  return HEIC_TYPES.has(file.type) ? decodeHeic(file) : file
}

export type ResizeResult = {
  file: File
  width: number
  height: number
}

export async function resizeImage(file: File): Promise<ResizeResult> {
  const decoded = HEIC_TYPES.has(file.type) ? await decodeHeic(file) : file
  const img = await loadImage(decoded)
  let { width, height } = img

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })

  const jpegName = decoded.name.replace(/\.[^.]*$/, '') + '.jpg'
  return {
    file: new File([blob], jpegName, { type: 'image/jpeg' }),
    width,
    height,
  }
}

export async function prepareProfileImage(file: File): Promise<File> {
  const decoded = HEIC_TYPES.has(file.type) ? await decodeHeic(file) : file
  const img = await loadImage(decoded)
  const sourceSize = Math.min(img.naturalWidth, img.naturalHeight)
  if (!sourceSize) throw new Error('Cannot read image dimensions')

  const canvas = document.createElement('canvas')
  canvas.width = PROFILE_IMAGE_DIMENSION
  canvas.height = PROFILE_IMAGE_DIMENSION
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(
    img,
    Math.floor((img.naturalWidth - sourceSize) / 2),
    Math.floor((img.naturalHeight - sourceSize) / 2),
    sourceSize,
    sourceSize,
    0,
    0,
    PROFILE_IMAGE_DIMENSION,
    PROFILE_IMAGE_DIMENSION,
  )
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error('Canvas toBlob failed')),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
  return new File([blob], 'profile.jpg', { type: 'image/jpeg' })
}

export class PresignedUploadError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed (${status})`)
    this.name = 'PresignedUploadError'
  }
}

export async function uploadToPresignedUrl({
  uploadUrl,
  body,
  contentType,
  signal,
}: {
  uploadUrl: string
  body: Blob
  contentType: string
  signal?: AbortSignal
}): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
    signal,
  })
  if (!response.ok) throw new PresignedUploadError(response.status)
}

export function useExpenseDocumentUpload(ledgerId?: string | null) {
  const presignMutation = trpc.uploads.presign.useMutation()

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- S3 upload, caller invalidates with returned URL
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const contentType = file.type || 'application/octet-stream'
      const { uploadUrl, fileUrl } = await presignMutation.mutateAsync({
        ledgerId: ledgerId ?? '',
        fileName: file.name,
        contentType,
        fileSize: file.size,
      })
      await uploadToPresignedUrl({
        uploadUrl,
        contentType,
        body: file,
      })
      return { url: fileUrl }
    },
  })

  return {
    uploadToS3: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
  }
}
