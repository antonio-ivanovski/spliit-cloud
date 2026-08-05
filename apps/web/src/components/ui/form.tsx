import { mergeProps } from '@base-ui/react/merge-props'
import * as React from 'react'
import type {
  ControllerProps,
  FieldPath,
  FieldValues} from 'react-hook-form';
import {
  Controller,
  FormProvider,
  useFormContext,
} from 'react-hook-form'

import { Label } from '@/components/ui/label'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  const value = React.useMemo(() => ({ name: props.name }), [props.name])
  return (
    <FormFieldContext.Provider value={value}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>')
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue,
)

const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const id = React.useId()
  const value = React.useMemo(() => ({ id }), [id])

  return (
    <FormItemContext.Provider value={value}>
      <div
        ref={ref}
        className={cn('col-span-2 md:col-span-1 space-y-2', className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
})
FormItem.displayName = 'FormItem'

const FormLabel = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<'label'>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()

  return (
    <Label
      ref={ref}
      className={cn(error && 'text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

type FormControlProps = React.HTMLAttributes<HTMLElement> & {
  children: React.ReactElement
}

/**
 * Applies the field's id and aria wiring to its single child, the way the
 * former Radix `Slot` did: the child's own props win, event handlers are
 * chained and `className`/`style` are merged.
 */
const FormControl = ({ children, ...props }: FormControlProps) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  const child = React.Children.only(children) as React.ReactElement<
    Record<string, unknown>
  >

  return React.cloneElement(
    child,
    mergeProps<'div'>(
      {
        id: formItemId,
        'aria-describedby': !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`,
        'aria-invalid': !!error,
      } as React.ComponentProps<'div'>,
      props as React.ComponentProps<'div'>,
      child.props as React.ComponentProps<'div'>,
    ) as Record<string, unknown>,
  )
}
FormControl.displayName = 'FormControl'

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()

  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
})
FormDescription.displayName = 'FormDescription'

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: 'SchemaErrors' })
  const { error, formMessageId } = useFormField()
  let body: React.ReactNode
  if (error) {
    // Array-level issues land on `errors.<name>.root` (RHF's documented
    // array-root pattern) when child fields are registered — e.g. the
    // `items` amountSum while `items.0.title` is mounted. Row-only errors
    // leave `error` as an array/object with no string message anywhere;
    // rendering `String(undefined)` would print the literal text
    // "undefined", so bail out in that case.
    const rootNested =
      typeof error === 'object' &&
      error !== null &&
      (error as { root?: { message?: unknown } }).root?.message
    const raw = error?.message ?? rootNested
    if (raw == null || typeof raw !== 'string') {
      return null
    }
    // The Zod schema codes (e.g. "min1", "duplicateParticipantName") map
    // 1:1 to keys under `SchemaErrors`. If the key exists, translate it;
    // otherwise fall back to the raw message text.
    const translated = i18n.exists(`SchemaErrors.${raw}`) ? t(raw as never) : raw
    body = translated
  } else {
    body = children
  }

  if (!body) {
    return null
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-sm font-medium text-destructive', className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = 'FormMessage'

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
}
