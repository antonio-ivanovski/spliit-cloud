import { type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

export function WizardStepHeader(props: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm tracking-wide text-muted-foreground uppercase">
        {props.eyebrow}
      </p>
      <h1 className="text-2xl leading-none font-semibold">{props.title}</h1>
      {props.description && (
        <p className="text-sm text-muted-foreground">{props.description}</p>
      )}
    </div>
  )
}

export function WizardNav(props: {
  back?: { label: string; onClick: () => void }
  continue?: {
    label: ReactNode
    onClick?: () => void
    form?: string
    disabled?: boolean
  }
}) {
  if (!props.back && !props.continue) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {props.back ? (
        <Button variant="ghost" onClick={props.back.onClick} type="button">
          {props.back.label}
        </Button>
      ) : (
        <span />
      )}
      {props.continue && (
        <Button
          type={props.continue.form ? 'submit' : 'button'}
          form={props.continue.form}
          onClick={props.continue.onClick}
          disabled={
            props.continue.disabled ||
            (!props.continue.form && !props.continue.onClick)
          }
        >
          {props.continue.label}
        </Button>
      )}
    </div>
  )
}
