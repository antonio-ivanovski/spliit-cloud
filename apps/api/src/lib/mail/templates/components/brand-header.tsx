import { Img, Section } from '@react-email/components'

type BrandHeaderProps = {
  /** Absolute URL prefix under which the logo PNG is served. */
  brandBaseUrl: string
}

/**
 * Brand header used at the top of every email.
 *
 * Combined logo wordmark as a single PNG. We serve it from the web app's
 * `/public` directory — SVG and WEBP have spotty rendering across email
 * clients, so we stick with PNG.
 */
export function BrandHeader({ brandBaseUrl }: BrandHeaderProps) {
  return (
    <Section className="mb-6 border-b border-solid border-[#e5e7eb] pb-4">
      <Img
        src={`${brandBaseUrl}/logo-with-text-email.png`}
        alt="Spliit Cloud"
        width="160"
        height="48"
        style={{
          display: 'block',
          outline: 'none',
        }}
      />
    </Section>
  )
}
