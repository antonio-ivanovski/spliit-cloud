import { ChangeEvent, InputHTMLAttributes, useRef } from 'react'

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

export function usePresignedUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function uploadToS3(file: File) {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    const presignResponse = await fetch(`${apiUrl}/uploads/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
      }),
    })
    if (!presignResponse.ok) throw new Error('Could not create upload URL')
    const { uploadUrl, fileUrl } = (await presignResponse.json()) as {
      uploadUrl: string
      fileUrl: string
    }
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!uploadResponse.ok) throw new Error('Upload failed')
    return { url: fileUrl }
  }

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
    uploadToS3,
  }
}
