import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { Sparkles } from 'lucide-react'

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

function ToasterViewport() {
  const { toasts } = ToastPrimitive.useToastManager()

  return (
    <>
      {toasts.map((toastItem) => {
        const variant = toastItem.data?.variant ?? 'default'
        return (
          <Toast key={toastItem.id} toast={toastItem} variant={variant}>
            {variant === 'success' && (
              <span
                aria-hidden="true"
                className="motion-success-sparkle flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
              >
                <Sparkles className="size-4" />
              </span>
            )}
            <div className="grid gap-1">
              {toastItem.title != null && toastItem.title !== '' && (
                <ToastTitle>{toastItem.title}</ToastTitle>
              )}
              {toastItem.description != null &&
                toastItem.description !== '' && (
                  <ToastDescription>{toastItem.description}</ToastDescription>
                )}
            </div>
            {toastItem.data?.action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </>
  )
}

export function Toaster() {
  return (
    <ToastProvider>
      <ToasterViewport />
    </ToastProvider>
  )
}
