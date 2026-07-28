/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- label receives drag-and-drop events for its file input. */
import { FileUp } from 'lucide-react'
import type { ChangeEvent, DragEvent } from 'react'

import { Card, CardContent } from '@/components/ui/card'

type FileUploadCardProps = {
  disabled: boolean
  isDragging: boolean
  onDragOver: (e: DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent) => void
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  accept: string
  labels: {
    dropFile: string
    dropFileDescription: string
  }
}

export function FileUploadCard({
  disabled,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  accept,
  labels,
}: FileUploadCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <label
          className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 transition ${
            disabled
              ? 'pointer-events-none opacity-50'
              : 'cursor-pointer hover:border-primary/60'
          } ${isDragging ? 'border-primary bg-primary/5' : 'border-muted'}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <FileUp className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">{labels.dropFile}</span>
          <span className="max-w-md text-center text-xs text-muted-foreground">
            {labels.dropFileDescription}
          </span>
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled}
            onChange={onFileChange}
          />
        </label>
      </CardContent>
    </Card>
  )
}
