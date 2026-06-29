import { Form, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { render, screen } from '@/test/test-utils'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

function TestForm({ message }: { message: string }) {
  const form = useForm({ defaultValues: { test: '' } })

  useEffect(() => {
    form.setError('test', { type: 'custom', message })
  }, [message])

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
})
