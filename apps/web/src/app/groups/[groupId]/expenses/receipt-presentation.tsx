import { Camera, ScanLine, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/** Shared scan overlay. Animation is optional so offline renderers can drive it. */
export function ReceiptScanningOverlay({
  hint,
  pulse,
}: {
  hint: string
  pulse?: number
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 p-3 text-center text-xs font-medium text-foreground backdrop-blur-[1px]">
      <span
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/15 text-pink-600 shadow-[0_0_24px_rgba(236,72,153,0.55)]"
        style={pulse === undefined ? undefined : { opacity: pulse }}
      >
        <ScanLine
          className={pulse === undefined ? 'h-7 w-7 animate-pulse' : 'h-7 w-7'}
        />
        <Sparkles
          className={
            pulse === undefined
              ? 'absolute -end-1 -top-1 h-6 w-6 animate-[pulse_1.2s_ease-in-out_infinite] text-pink-600 drop-shadow-[0_0_9px_rgba(236,72,153,1)]'
              : 'absolute -end-1 -top-1 h-6 w-6 text-pink-600 drop-shadow-[0_0_9px_rgba(236,72,153,1)]'
          }
        />
      </span>
      <span>{hint}</span>
    </div>
  )
}

export function AiExpenseFields({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm">
      {children}
    </div>
  )
}

export function ReceiptUploadAction({
  label,
  cameraLabel,
  onScan,
  onCamera,
  disabled,
}: {
  label: string
  cameraLabel: string
  onScan: () => void
  onCamera: () => void
  disabled?: boolean
}) {
  return (
    <div className="not-prose inline-flex w-full overflow-hidden rounded-md border">
      <Button
        type="button"
        variant="outline"
        className="min-w-0 flex-1 rounded-none border-0"
        onClick={onScan}
        disabled={disabled}
      >
        <ScanLine className="me-2 h-4 w-4" />
        {label}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="rounded-none border-0 border-s sm:hidden"
        onClick={onCamera}
        disabled={disabled}
        aria-label={cameraLabel}
      >
        <Camera className="h-4 w-4" />
      </Button>
    </div>
  )
}
