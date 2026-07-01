import { useMutation } from '@tanstack/react-query'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { useRef } from 'react'

const MAX_DIMENSION = 2560
const JPEG_QUALITY = 0.8
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

export function usePresignedUpload(ledgerId?: string | null) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
      const contentType = file.type || 'application/octet-stream'
      const presignResponse = await fetch(`${apiUrl}/uploads/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ledgerId,
          fileName: file.name,
          contentType,
          fileSize: file.size,
        }),
      })
      if (!presignResponse.ok) throw new Error('Could not create upload URL')
      const { uploadUrl, fileUrl } = (await presignResponse.json()) as {
        uploadUrl: string
        fileUrl: string
      }
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
      if (!uploadResponse.ok) throw new Error('Upload failed')
      return { url: fileUrl }
    },
  })

  function FileInput({
    onChange,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
    onChange: (file: File) => void
  }) {
    return (
      <input
        {...props}
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          if (file) onChange(file)
          event.target.value = ''
        }}
      />
    )
  }

  return {
    FileInput,
    openFileDialog: () => inputRef.current?.click(),
    uploadToS3: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
  }
}
