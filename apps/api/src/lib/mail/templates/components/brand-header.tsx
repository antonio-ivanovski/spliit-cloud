import { Img, Section, Text } from '@react-email/components'

type BrandHeaderProps = {
  /** Absolute URL prefix under which the logo PNG is served. */
  brandBaseUrl: string
}

/**
 * Brand header used at the top of every email.
 *
 * Spliit logo (the green "bill" mark) next to the wordmark "Spliit Cloud",
 * inside a bordered card. The PNG is copied from `apps/web/public` so
 * the email can reference it with a stable absolute URL — SVG and WEBP
 * have spotty rendering across email clients, so we use PNG.
 */
export function BrandHeader({ brandBaseUrl }: BrandHeaderProps) {
  return (
    <Section className="border-b border-solid border-[#e5e7eb] pb-4 mb-6">
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        width="100%"
      >
        <tr>
          <td align="left" valign="middle" style={{ verticalAlign: 'middle' }}>
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              border={0}
            >
              <tr>
                <td style={{ paddingRight: '12px', verticalAlign: 'middle' }}>
                  <Img
                    src={`${brandBaseUrl}/logo-192x192.png`}
                    alt="Spliit Cloud"
                    width="36"
                    height="36"
                    style={{
                      display: 'block',
                      borderRadius: '8px',
                      outline: 'none',
                    }}
                  />
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  <Text className="m-0 text-[20px] font-semibold text-[#0f172a] tracking-tight">
                    Spliit Cloud
                  </Text>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </Section>
  )
}
