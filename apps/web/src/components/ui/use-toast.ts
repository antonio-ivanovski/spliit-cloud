import type { ReactNode } from 'react'

import {
  toastManager,
  type ToastActionElement,
  type ToastVariant,
} from '@/components/ui/toast'

type ToastInput = {
  title?: ReactNode
  description?: ReactNode
  action?: ToastActionElement
  variant?: ToastVariant
  timeout?: number
}

function toast({
  title,
  description,
  action,
  variant = 'default',
  timeout,
}: ToastInput) {
  const id = toastManager.add({
    title,
    description,
    type: variant,
    timeout,
    data: { variant, action },
  })

  return {
    id,
    dismiss: () => toastManager.close(id),
    update: (props: ToastInput) =>
      toastManager.update(id, {
        title: props.title,
        description: props.description,
        type: props.variant,
        timeout: props.timeout,
        data: {
          variant: props.variant,
          action: props.action,
        },
      }),
  }
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string) => toastManager.close(toastId),
  }
}

export { toast, useToast }
