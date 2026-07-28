import { render } from '@react-email/components'
import type { ReactElement } from 'react'

import type { RenderedEmail } from './types'

/**
 * Render a React Email component to both HTML and plain-text bodies.
 *
 * The React Email `render` helper handles Outlook comments, accessibility, and
 * width attributes that other libraries don't replicate.
 */
export async function renderTemplate(
  component: ReactElement,
  options: { subject: string; text: string },
): Promise<RenderedEmail> {
  const html = await render(component)
  return {
    subject: options.subject,
    text: options.text,
    html,
  }
}
