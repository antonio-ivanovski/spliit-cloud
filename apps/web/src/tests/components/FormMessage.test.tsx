import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import { Form, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { render, screen } from '@/test/test-utils'

function TestForm({ message }: { message: string }) {
  const form = useForm({ defaultValues: { test: '' } })

  useEffect(() => {
    form.setError('test', { type: 'custom', message })
  }, [message, form])

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="test"
        render={() => (
          <FormItem>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  )
}

/** Array-shaped error (row-level issues under a parent array name). */
function ArrayErrorForm() {
  const form = useForm({ defaultValues: { test: [] } })

  useEffect(() => {
    form.setError('test', {
      type: 'custom',
      message: undefined,
    })
  }, [form])

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="test"
        render={() => (
          <FormItem>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  )
}

describe('FormMessage', () => {
  it('translates SchemaErrors keys via the keyPrefix', async () => {
    render(<TestForm message="noZeroShares" />)

    expect(
      await screen.findByText('All shares must be higher than 0.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('noZeroShares')).not.toBeInTheDocument()
  })

  it('falls back to raw text when the key is not in SchemaErrors', async () => {
    render(<TestForm message="someUnknownKey" />)

    expect(await screen.findByText('someUnknownKey')).toBeInTheDocument()
  })

  it('renders nothing when the error has no string message', async () => {
    render(<ArrayErrorForm />)

    // Row-level array errors must not render the literal "undefined".
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(
      screen.queryByText('All shares must be higher than 0.'),
    ).not.toBeInTheDocument()
  })
})
