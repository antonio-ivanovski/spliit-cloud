import { render } from '@react-email/components'
import type { ReactElement } from 'react'
import type { RenderedEmail } from './types'

/**
 * Render a React Email component to both HTML and plain-text bodies.
 *
 * `renderToStaticMarkup` would skip React Email's `--pretty` handling
 * and the optional plain-text mode below; the React Email `render`
 * helper handles Outlook comments, accessibility, and width attributes
 * that other libraries don't replicate.
 *
 * Most callers keep `text` as an explicitly built string (see the
 * individual template files) because react-email's auto-generated
 * plain-text adds visual noise around buttons and section borders.
 * When the caller leaves `text` undefined we fall back to react-email's
 * plain text conversion.
 */
export async function renderTemplate(
  component: ReactElement,
  options: { subject: string; text?: string },
): Promise<RenderedEmail> {
  const html = await render(component)
  const text = options.text ?? (await render(component, { plainText: true }))
  return {
    subject: options.subject,
    text,
    html,
  }
}

/** Single-call helper for the very common "render + send" flow. */
export async function renderTemplateAndText(
  htmlComponent: ReactElement,
  text: string,
  subject: string,
): Promise<RenderedEmail> {
  return renderTemplate(htmlComponent, { subject, text })
}
