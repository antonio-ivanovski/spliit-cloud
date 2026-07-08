import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Tailwind,
} from '@react-email/components'
import type { ReactNode } from 'react'
import { tailwindConfig } from '../tailwind'
import { BrandHeader } from './brand-header'
import { EmailFooter } from './email-footer'

type EmailLayoutProps = {
  preview: string
  /** Absolute URL prefix for the logo asset (e.g. `https://spliit.app`). */
  brandBaseUrl: string
  children: ReactNode
}

/**
 * Branded wrapper for every email in this package.
 *
 * Mirrors the web app shell: light gray page background, white card
 * with a thin border and rounded corners, Spliit logo + wordmark
 * header, and a small text footer at the bottom. Internal callers
 * (auth/invitation/friend/expense templates) drop their content into
 * `children`.
 */
export function EmailLayout({
  preview,
  brandBaseUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Tailwind config={tailwindConfig}>
        <Preview>{preview}</Preview>
        <Body className="bg-[#f1f5f9] font-sans m-0 p-0">
          <Container className="bg-white border border-solid border-[#e5e7eb] rounded-[12px] max-w-[600px] mx-auto my-8 p-8">
            <BrandHeader brandBaseUrl={brandBaseUrl} />
            {children}
            <EmailFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
