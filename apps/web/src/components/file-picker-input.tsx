import { forwardRef, type InputHTMLAttributes } from 'react'

export type FilePickerInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> & {
  onFilesSelected: (files: File[]) => void
}

export const FilePickerInput = forwardRef<
  HTMLInputElement,
  FilePickerInputProps
>(function FilePickerInput({ onFilesSelected, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="file"
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        try {
          if (files.length > 0) onFilesSelected(files)
        } finally {
          event.currentTarget.value = ''
        }
      }}
    />
  )
})
